import { randomUUID } from "node:crypto";

import { extractContactInfo } from "@/lib/contact-parser";
import { getOcrClient } from "@/lib/ocr";
import { signDraftToken } from "@/lib/session";
import { buildAssetUrl, getStorage } from "@/lib/storage";
import type { CardDraft } from "@/lib/types";

export interface ScanPayload {
  originalBuffer: Buffer;
  originalMimeType: string;
  correctedBuffer: Buffer;
  correctedMimeType: string;
}

function extensionFromMimeType(mimeType: string) {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    default:
      return "jpg";
  }
}

export async function scanBusinessCard(payload: ScanPayload): Promise<CardDraft> {
  const storage = getStorage();
  const ocr = getOcrClient();
  const scanId = randomUUID();
  const originalKey = `drafts/${scanId}/original.${extensionFromMimeType(
    payload.originalMimeType
  )}`;
  const correctedKey = `drafts/${scanId}/corrected.${extensionFromMimeType(
    payload.correctedMimeType
  )}`;

  await storage.putObject({
    key: originalKey,
    body: payload.originalBuffer,
    contentType: payload.originalMimeType
  });
  await storage.putObject({
    key: correctedKey,
    body: payload.correctedBuffer,
    contentType: payload.correctedMimeType
  });

  const ocrResult = await ocr.recognize({
    buffer: payload.correctedBuffer,
    mimeType: payload.correctedMimeType
  });
  const extraction = extractContactInfo(ocrResult);
  const originalImageUrl = buildAssetUrl(originalKey);
  const correctedImageUrl = buildAssetUrl(correctedKey);
  const draftToken = await signDraftToken({
    originalImageUrl,
    correctedImageUrl,
    rawOcrText: ocrResult.rawText,
    confidence: extraction.confidence,
    suggestedFullName: extraction.fullName,
    suggestedOrganization: extraction.organization,
    suggestedJobTitle: extraction.jobTitle,
    suggestedEmail: extraction.email
  });

  return {
    draftToken,
    tempImageUrl: correctedImageUrl,
    originalImageUrl,
    correctedImageUrl,
    fullName: extraction.fullName,
    organization: extraction.organization,
    jobTitle: extraction.jobTitle,
    email: extraction.email,
    confidence: extraction.confidence,
    warnings: extraction.warnings,
    rawOcrText: ocrResult.rawText
  };
}

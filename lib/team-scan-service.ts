import sharp from "sharp";
import { ApiError } from "@/lib/api-error";
import { extractContactInfo } from "@/lib/contact-parser";
import { getOcrClient } from "@/lib/ocr";
import { ScanProcessingError, getScanFailure } from "@/lib/scan-errors";
import { getStorage } from "@/lib/storage";
import {
  addDraftAsset,
  completeDraft,
  consumeScanQuota,
  failDraft,
  getDraft,
  reserveDraft,
  retryDraftLease,
  teamSql,
} from "@/lib/team-db";
import type { TeamSession } from "@/lib/team-types";

export async function readUploadForm(request: Request) {
  const limit = 3_800_000;
  if (Number(request.headers.get("content-length")) > limit)
    throw new ApiError(
      413,
      "IMAGE_TOO_LARGE",
      "画像の合計サイズが大きすぎます。",
    );
  const reader = request.body?.getReader();
  if (!reader)
    throw new ApiError(400, "INVALID_UPLOAD", "画像を選択してください。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.length;
    if (size > limit) {
      await reader.cancel();
      throw new ApiError(
        413,
        "IMAGE_TOO_LARGE",
        "画像の合計サイズが大きすぎます。",
      );
    }
    chunks.push(result.value);
  }
  try {
    return await new Response(Buffer.concat(chunks), {
      headers: { "Content-Type": request.headers.get("content-type") || "" },
    }).formData();
  } catch {
    throw new ApiError(
      400,
      "INVALID_UPLOAD",
      "画像の送信形式を確認してください。",
    );
  }
}
export async function decodeImage(
  value: FormDataEntryValue | null,
): Promise<Buffer> {
  if (!(value instanceof File) || value.size === 0 || value.size > 1_800_000)
    throw new ApiError(
      422,
      "INVALID_IMAGE",
      "1.8MB以下の画像を選択してください。",
    );
  const formats: Record<string, string> = {
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/webp": "webp",
  };
  if (!formats[value.type])
    throw new ApiError(
      422,
      "INVALID_IMAGE",
      "JPEG・PNG・WebP形式の画像を選択してください。",
    );
  try {
    const image = sharp(Buffer.from(await value.arrayBuffer()), {
      limitInputPixels: 12_000_000,
      failOn: "warning",
    });
    const meta = await image.metadata();
    if (
      meta.format !== formats[value.type] ||
      !meta.width ||
      !meta.height ||
      Math.min(meta.width, meta.height) < 100 ||
      (meta.pages && meta.pages > 1)
    )
      throw new Error("Invalid image");
    const normalized = await image
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 88 })
      .toBuffer();
    if (normalized.length > 1_800_000)
      throw new Error("Decoded image too large");
    return normalized;
  } catch {
    throw new ApiError(
      422,
      "INVALID_IMAGE",
      "画像を読み込めません。明るい場所で撮り直してください。",
    );
  }
}
async function recognize(
  s: TeamSession,
  id: string,
  buffer: Buffer,
  consumeQuota = true,
) {
  try {
    if (consumeQuota) await consumeScanQuota(s);
    let result;
    try {
      result = await getOcrClient().recognize({
        buffer,
        mimeType: "image/jpeg",
      });
    } catch (e) {
      throw new ScanProcessingError("ocr", e);
    }
    const parsed = extractContactInfo(result);
    return await completeDraft(
      s,
      id,
      {
        fullName: parsed.fullName || "",
        organization: parsed.organization || "",
        jobTitle: parsed.jobTitle || "",
        email: parsed.email || "",
      },
      result.rawText,
      parsed.confidence,
      parsed.warnings,
    );
  } catch (error) {
    const failure = getScanFailure(error);
    const code = error instanceof ApiError ? error.code : failure.code,
      message = error instanceof ApiError ? error.message : failure.error;
    await failDraft(s, id, code, message);
    if (error instanceof ApiError) throw error;
    throw new ApiError(failure.status, code, message);
  }
}
export async function createTeamScan(
  s: TeamSession,
  clientId: string,
  original: Buffer,
  corrected: Buffer,
) {
  const draft = await reserveDraft(s, clientId);
  if (!draft.created) return getDraft(s, draft.id);
  try {
    await consumeScanQuota(s);
  } catch (error) {
    await failDraft(
      s,
      draft.id,
      error instanceof ApiError ? error.code : "QUOTA_UNAVAILABLE",
      error instanceof ApiError
        ? error.message
        : "利用上限を確認できませんでした。再試行してください。",
    );
    throw error;
  }
  try {
    const storage = getStorage();
    for (const [kind, body] of [
      ["original", original],
      ["corrected", corrected],
    ] as const) {
      const key = await addDraftAsset(
        s,
        draft.id,
        kind,
        body.length,
        "image/jpeg",
      );
      await storage.putObject({ key, body, contentType: "image/jpeg" });
    }
  } catch (error) {
    const failure = getScanFailure(new ScanProcessingError("storage", error));
    await failDraft(s, draft.id, failure.code, failure.error);
    throw new ApiError(502, failure.code, failure.error);
  }
  return recognize(s, draft.id, corrected, false);
}
export async function retryTeamScan(s: TeamSession, id: string) {
  await retryDraftLease(s, id);
  let body: Uint8Array;
  try {
    const [asset] =
      await teamSql()`select storage_key from name_card.assets where draft_id=${id} and team_id=${s.teamId} and kind='corrected'`;
    if (!asset) throw new Error("No image");
    body = (await getStorage().getObject(asset.storage_key)).body;
  } catch {
    await failDraft(
      s,
      id,
      "IMAGE_UNAVAILABLE",
      "画像を取得できませんでした。撮り直してください。",
    );
    throw new ApiError(
      422,
      "IMAGE_UNAVAILABLE",
      "画像を取得できませんでした。撮り直してください。",
    );
  }
  return recognize(s, id, Buffer.from(body));
}

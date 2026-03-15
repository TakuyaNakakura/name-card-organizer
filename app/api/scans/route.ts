import { NextResponse } from "next/server";

import { getOptionalIntEnv } from "@/lib/env";
import { getClientAddress, requireSession } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";
import { scanBusinessCard } from "@/lib/scan-service";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SCAN_IMAGE_BYTES = getOptionalIntEnv("MAX_SCAN_IMAGE_BYTES", 1_800_000);
const SCAN_RATE_LIMIT_MAX_REQUESTS = getOptionalIntEnv(
  "SCAN_RATE_LIMIT_MAX_REQUESTS",
  30
);
const SCAN_RATE_LIMIT_WINDOW_MS = getOptionalIntEnv(
  "SCAN_RATE_LIMIT_WINDOW_MS",
  60 * 60 * 1000
);

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function isFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File;
}

function validateImageFile(file: File, fieldName: string) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type || "image/jpeg")) {
    return `${fieldName} must be a JPEG, PNG, or WebP image`;
  }

  if (file.size > MAX_SCAN_IMAGE_BYTES) {
    return `${fieldName} exceeds the upload size limit`;
  }

  return null;
}

export async function POST(request: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = consumeRateLimit({
    key: "scan",
    identifier: getClientAddress(request),
    limit: SCAN_RATE_LIMIT_MAX_REQUESTS,
    windowMs: SCAN_RATE_LIMIT_WINDOW_MS
  });
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "Too many scan requests. Please wait and try again." },
      { status: 429 }
    );
  }

  const formData = await request.formData();
  const originalImage = formData.get("originalImage");
  const correctedImage = formData.get("correctedImage");

  if (!isFile(originalImage) || !isFile(correctedImage)) {
    return NextResponse.json(
      { error: "originalImage and correctedImage are required" },
      { status: 400 }
    );
  }

  const originalImageError = validateImageFile(originalImage, "originalImage");
  const correctedImageError = validateImageFile(correctedImage, "correctedImage");
  if (originalImageError || correctedImageError) {
    return NextResponse.json(
      {
        error: originalImageError ?? correctedImageError
      },
      { status: 400 }
    );
  }

  const [originalBuffer, correctedBuffer] = await Promise.all([
    Buffer.from(await originalImage.arrayBuffer()),
    Buffer.from(await correctedImage.arrayBuffer())
  ]);

  const draft = await scanBusinessCard({
    originalBuffer,
    originalMimeType: originalImage.type || "image/jpeg",
    correctedBuffer,
    correctedMimeType: correctedImage.type || "image/jpeg"
  });

  return NextResponse.json(draft);
}

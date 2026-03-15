import { NextResponse } from "next/server";

import { requireSession } from "@/lib/http";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

function sanitizeKey(parts: string[]) {
  return parts.filter((part) => part && part !== "." && part !== "..").join("/");
}

function isMissingAssetError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  if ("code" in error && error.code === "ENOENT") {
    return true;
  }

  if ("name" in error && error.name === "NoSuchKey") {
    return true;
  }

  return false;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storageKey: string[] }> }
) {
  try {
    await requireSession();
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { storageKey } = await params;
  const key = sanitizeKey(storageKey);
  if (!key) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const object = await getStorage().getObject(key);
    return new NextResponse(Buffer.from(object.body), {
      status: 200,
      headers: {
        "Content-Type": object.contentType,
        "Cache-Control": "private, max-age=3600"
      }
    });
  } catch (error) {
    if (isMissingAssetError(error)) {
      return new NextResponse("Not found", { status: 404 });
    }

    throw error;
  }
}

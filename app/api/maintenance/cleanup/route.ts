import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { apiError, ApiError } from "@/lib/api-error";
import { runMaintenance } from "@/lib/maintenance";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET,
      value = request.headers.get("authorization") || "",
      expected = `Bearer ${secret}`;
    if (
      !secret ||
      Buffer.byteLength(value) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(value), Buffer.from(expected))
    )
      throw new ApiError(401, "UNAUTHENTICATED", "認証が必要です。");
    return NextResponse.json(await runMaintenance());
  } catch (error) {
    return apiError(error);
  }
}

import { NextResponse } from "next/server";
import {
  ApiError,
  apiError,
  assertSameOrigin,
  readJson,
} from "@/lib/api-error";
import { getTeamAuthMode } from "@/lib/auth-config";
import { resetMemberPassword } from "@/lib/credentials";
import { requireSession } from "@/lib/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    assertSameOrigin(request);
    if (getTeamAuthMode() !== "password")
      throw new ApiError(404, "NOT_FOUND", "この認証方式では利用できません。");
    const body = await readJson(request);
    const { id } = await params;
    if (!id || id.length > 128)
      throw new ApiError(422, "INVALID_ID", "メンバーIDが不正です。");
    return NextResponse.json(
      await resetMemberPassword(session, id, body.username),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

import { NextResponse } from "next/server";
import {
  ApiError,
  apiError,
  assertSameOrigin,
  readJson,
} from "@/lib/api-error";
import { getTeamAuthMode } from "@/lib/auth-config";
import { changeOwnPassword } from "@/lib/credentials";
import { requireSession } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const session = await requireSession({ allowPasswordChange: true });
    assertSameOrigin(request);
    if (getTeamAuthMode() !== "password")
      throw new ApiError(404, "NOT_FOUND", "この認証方式では利用できません。");
    await changeOwnPassword(session, await readJson(request));
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

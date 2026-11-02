import { NextResponse } from "next/server";
import { ApiError, apiError, assertSameOrigin } from "@/lib/api-error";
import { readJson } from "@/lib/api-error";
import { requireSession } from "@/lib/http";
import { changeMember } from "@/lib/team-db";
export async function PATCH(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    assertSameOrigin(request);
    const body = await readJson(request);
    if (
      !["admin", "member"].includes(body.role) ||
      !["active", "suspended"].includes(body.status)
    )
      throw new ApiError(
        422,
        "INVALID_MEMBER",
        "権限と状態を確認してください。",
      );
    await changeMember(s, (await c.params).id, body.role, body.status);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

import { NextResponse } from "next/server";
import { ApiError, apiError, assertSameOrigin } from "@/lib/api-error";
import { readJson } from "@/lib/api-error";
import { requireSession } from "@/lib/http";
import { inviteMember, invitations, members } from "@/lib/team-db";
export async function GET() {
  try {
    const s = await requireSession();
    if (s.role !== "admin")
      throw new ApiError(403, "FORBIDDEN", "管理者だけが利用できます。");
    return NextResponse.json({
      members: await members(s),
      invitations: await invitations(s),
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    const s = await requireSession();
    assertSameOrigin(request);
    const body = await readJson(request);
    if (
      typeof body.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) ||
      !["member", "admin"].includes(body.role)
    )
      throw new ApiError(
        422,
        "INVALID_INVITE",
        "メールアドレスと権限を確認してください。",
      );
    await inviteMember(s, body.email.trim().toLowerCase(), body.role);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

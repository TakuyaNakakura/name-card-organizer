import { NextResponse } from "next/server";
import { requireSession } from "@/lib/http";
import { teamSql } from "@/lib/team-db";
import { apiError, ApiError } from "@/lib/api-error";
export async function GET() {
  try {
    const s = await requireSession();
    if (s.role !== "admin")
      throw new ApiError(403, "FORBIDDEN", "管理者だけが利用できます。");
    await teamSql()`select 1 from name_card.teams limit 1`;
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

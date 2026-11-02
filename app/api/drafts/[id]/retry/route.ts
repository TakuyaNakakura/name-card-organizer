import { NextResponse } from "next/server";
import { apiError, assertSameOrigin, requireUuid } from "@/lib/api-error";
import { requireSession } from "@/lib/http";
import { retryTeamScan } from "@/lib/team-scan-service";
export const maxDuration = 60;
export async function POST(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    assertSameOrigin(request);
    return NextResponse.json(
      await retryTeamScan(s, requireUuid((await c.params).id)),
    );
  } catch (error) {
    return apiError(error);
  }
}

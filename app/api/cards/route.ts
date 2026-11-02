import { NextResponse } from "next/server";
import {
  apiError,
  assertSameOrigin,
  requireUuid,
  requireVersion,
} from "@/lib/api-error";
import { readJson } from "@/lib/api-error";
import { requireSession } from "@/lib/http";
import { confirmDraft, listTeamCards } from "@/lib/team-db";
import { cardFilters } from "@/lib/card-filters";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const result = await listTeamCards(
      await requireSession(),
      cardFilters(new URL(request.url).searchParams),
    );
    return NextResponse.json({
      ...result,
      nextCursor:
        result.page * result.limit < result.total
          ? String(result.page + 1)
          : null,
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
    return NextResponse.json(
      await confirmDraft(
        s,
        requireUuid(body.draftId),
        requireVersion(body.version),
      ),
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}

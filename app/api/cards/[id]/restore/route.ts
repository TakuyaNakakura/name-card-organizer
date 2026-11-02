import { NextResponse } from "next/server";
import {
  apiError,
  assertSameOrigin,
  requireUuid,
  requireVersion,
} from "@/lib/api-error";
import { readJson } from "@/lib/api-error";
import { requireSession } from "@/lib/http";
import { getCard, setCardDeleted } from "@/lib/team-db";
export async function POST(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    assertSameOrigin(request);
    const body = await readJson(request),
      id = requireUuid((await c.params).id);
    await setCardDeleted(s, id, requireVersion(body.version), true);
    return NextResponse.json(await getCard(s, id));
  } catch (error) {
    return apiError(error);
  }
}

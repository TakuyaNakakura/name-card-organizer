import { NextResponse } from "next/server";
import {
  ApiError,
  apiError,
  assertSameOrigin,
  requireUuid,
  requireVersion,
} from "@/lib/api-error";
import { readJson } from "@/lib/api-error";
import { requireSession } from "@/lib/http";
import { editCard, getCard, setCardDeleted } from "@/lib/team-db";
import { readContactFields } from "@/lib/contact-fields";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, c: Context) {
  try {
    return NextResponse.json(
      await getCard(await requireSession(), requireUuid((await c.params).id)),
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function PATCH(request: Request, c: Context) {
  try {
    const s = await requireSession();
    assertSameOrigin(request);
    const body = await readJson(request),
      fields = readContactFields(body);
    if (!fields)
      throw new ApiError(422, "INVALID_FIELDS", "入力内容を確認してください。");
    return NextResponse.json(
      await editCard(
        s,
        requireUuid((await c.params).id),
        requireVersion(body.version),
        fields,
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function DELETE(request: Request, c: Context) {
  try {
    const s = await requireSession();
    assertSameOrigin(request);
    const body = await readJson(request);
    await setCardDeleted(
      s,
      requireUuid((await c.params).id),
      requireVersion(body.version),
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}

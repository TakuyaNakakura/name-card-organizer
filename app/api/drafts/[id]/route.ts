import { NextResponse } from "next/server";
import {
  ApiError,
  apiError,
  assertSameOrigin,
  requireUuid,
  requireVersion,
} from "@/lib/api-error";
import { readJson } from "@/lib/api-error";
import { contactFieldErrors, readContactFields } from "@/lib/contact-fields";
import { requireSession } from "@/lib/http";
import { discardDraft, editDraft, getDraft } from "@/lib/team-db";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, c: Context) {
  try {
    return NextResponse.json(
      await getDraft(await requireSession(), requireUuid((await c.params).id)),
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
    const errors = contactFieldErrors(fields, false);
    if (Object.keys(errors).length)
      throw new ApiError(422, "INVALID_FIELDS", Object.values(errors)[0]);
    return NextResponse.json(
      await editDraft(
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
    await discardDraft(s, requireUuid((await c.params).id));
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}

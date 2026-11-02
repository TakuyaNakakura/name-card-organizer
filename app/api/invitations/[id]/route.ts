import { apiError, assertSameOrigin, requireUuid } from "@/lib/api-error";
import { requireSession } from "@/lib/http";
import { revokeInvitation } from "@/lib/team-db";
export async function DELETE(
  request: Request,
  c: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    assertSameOrigin(request);
    await revokeInvitation(s, requireUuid((await c.params).id));
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}

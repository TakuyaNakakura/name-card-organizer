import { apiError, requireUuid } from "@/lib/api-error";
import { requireSession } from "@/lib/http";
import { authorizedAsset } from "@/lib/team-db";
import { getStorage } from "@/lib/storage";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  c: { params: Promise<{ storageKey: string[] }> },
) {
  try {
    const s = await requireSession(),
      parts = (await c.params).storageKey,
      id = requireUuid(parts.length === 1 ? parts[0] : null);
    const asset = await authorizedAsset(s, id),
      object = await getStorage().getObject(asset.storage_key);
    return new Response(Buffer.from(object.body), {
      headers: {
        "Content-Type": asset.content_type,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

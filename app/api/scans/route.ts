import { NextResponse } from "next/server";
import { apiError, assertSameOrigin, requireUuid } from "@/lib/api-error";
import { requireSession } from "@/lib/http";
import {
  createTeamScan,
  decodeImage,
  readUploadForm,
} from "@/lib/team-scan-service";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    assertSameOrigin(request);
    const form = await readUploadForm(request),
      clientId = requireUuid(form.get("clientScanId"));
    const original = await decodeImage(form.get("originalImage")),
      corrected = await decodeImage(form.get("correctedImage"));
    return NextResponse.json(
      await createTeamScan(session, clientId, original, corrected),
    );
  } catch (error) {
    return apiError(error);
  }
}

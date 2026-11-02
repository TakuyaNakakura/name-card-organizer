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
import { confirmDraft } from "@/lib/team-db";
export async function POST(request: Request) {
  try {
    const s = await requireSession();
    assertSameOrigin(request);
    const body = await readJson(request);
    if (
      !Array.isArray(body.items) ||
      !body.items.length ||
      body.items.length > 50
    )
      throw new ApiError(
        422,
        "INVALID_BATCH",
        "1〜50件の下書きを指定してください。",
      );
    const input = body.items.map(
      (v: { draftId: unknown; version: unknown } | null) => ({
        draftId: requireUuid(v?.draftId),
        version: requireVersion(v?.version),
      }),
    );
    if (
      new Set(input.map((v: { draftId: string }) => v.draftId)).size !==
      input.length
    )
      throw new ApiError(
        422,
        "DUPLICATE_DRAFT",
        "同じ下書きが複数回指定されています。",
      );
    const results = [];
    for (const item of input) {
      try {
        results.push({
          draftId: item.draftId,
          ok: true,
          card: await confirmDraft(s, item.draftId, item.version),
        });
      } catch (error) {
        results.push({
          draftId: item.draftId,
          ok: false,
          error: {
            code:
              error instanceof ApiError ? error.code : "SERVICE_UNAVAILABLE",
            message:
              error instanceof ApiError
                ? error.message
                : "登録に失敗しました。下書きは残っています。",
          },
        });
      }
    }
    return NextResponse.json({ results });
  } catch (error) {
    return apiError(error);
  }
}

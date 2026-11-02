import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function apiError(error: unknown) {
  const requestId = randomUUID();
  const known = error instanceof ApiError;
  const status = known ? error.status : 503;
  const code = known ? error.code : "SERVICE_UNAVAILABLE";
  const message = known
    ? error.message
    : "処理を完了できませんでした。時間をおいて再試行してください。";
  console.error("Request failed", { requestId, code, status });
  return NextResponse.json({ error: { code, message, requestId } }, { status });
}

export function assertSameOrigin(request: Request) {
  const expected = new URL(process.env.BETTER_AUTH_URL || request.url).origin;
  if (request.headers.get("origin") !== expected) {
    throw new ApiError(
      403,
      "INVALID_ORIGIN",
      "この操作はアプリの画面から実行してください。",
    );
  }
}

export function requireUuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new ApiError(422, "INVALID_ID", "識別子が不正です。");
  }
  return value;
}

export function requireVersion(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1)
    throw new ApiError(
      422,
      "INVALID_VERSION",
      "データのバージョンを確認してください。",
    );
  return Number(value);
}

export async function readJson(request: Request): Promise<Record<string, any>> {
  const reader = request.body?.getReader();
  if (!reader)
    throw new ApiError(400, "INVALID_JSON", "入力データがありません。");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 65536) {
      await reader.cancel();
      throw new ApiError(413, "BODY_TOO_LARGE", "入力データが大きすぎます。");
    }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body;
  } catch {
    throw new ApiError(
      400,
      "INVALID_JSON",
      "入力データの形式を確認してください。",
    );
  }
}

import { ApiError } from "@/lib/api-error";
import type { CardFilters } from "@/lib/team-db";
export function cardFilters(params: URLSearchParams): CardFilters {
  for (const k of ["from", "to"]) {
    const value = params.get(k);
    if (
      value &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      throw new ApiError(422, "INVALID_DATE", "日付の形式を確認してください。");
  }
  const page = Number(params.get("page") || "1");
  if (!Number.isInteger(page) || page < 1)
    throw new ApiError(422, "INVALID_PAGE", "ページ番号を確認してください。");
  return {
    q: (params.get("q") || "").slice(0, 500),
    createdBy: params.get("createdBy") || undefined,
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    page,
  };
}

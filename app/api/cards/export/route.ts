import { apiError } from "@/lib/api-error";
import { requireSession } from "@/lib/http";
import { audit, listTeamCards } from "@/lib/team-db";
import { cardFilters } from "@/lib/card-filters";
import { cardsToCsv } from "@/lib/csv";
export async function GET(request: Request) {
  try {
    const s = await requireSession(),
      filters = cardFilters(new URL(request.url).searchParams);
    const rows = [];
    let page = 1,
      total = 0;
    do {
      const result = await listTeamCards(s, { ...filters, page, limit: 100 });
      rows.push(...result.items);
      total = result.total;
      page++;
    } while (rows.length < total && page <= 101);
    if (total > 10000)
      return new Response("検索条件を絞り、1万件以下で出力してください。", {
        status: 422,
      });
    await audit(s, "cards.export");
    return new Response(cardsToCsv(rows, { excelFriendly: true }), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="name-cards.csv"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

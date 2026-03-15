import { getDatabaseErrorMessage, listCards } from "@/lib/db";
import { cardsToCsv } from "@/lib/csv";
import { requireSession } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireSession();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const search = url.searchParams.get("q") ?? undefined;
  try {
    const csv = cardsToCsv(await listCards(search), {
      excelFriendly: true
    });

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="name-cards.csv"'
      }
    });
  } catch (error) {
    console.error("Failed to export cards", error);
    return new Response(getDatabaseErrorMessage(error), { status: 503 });
  }
}

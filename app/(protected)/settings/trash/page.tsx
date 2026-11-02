import Link from "next/link";
import { requirePageSession } from "@/lib/http";
import { listTeamCards } from "@/lib/team-db";
import { CardActions } from "@/components/cards/card-actions";
export default async function TrashPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const s = await requirePageSession("/settings/trash"),
    page = Math.max(1, Number((await searchParams).page) || 1),
    result = await listTeamCards(s, { trash: true, page });
  return (
    <main className="stack">
      <header className="page-heading">
        <h1>ごみ箱</h1>
        <p>
          削除後30日間は復元できます。その後は画像とデータを完全に削除します。登録者または管理者だけが操作できます。
        </p>
      </header>
      {!result.items.length && (
        <p className="empty-state">復元できる名刺はありません。</p>
      )}
      {result.items.map((c) => (
        <article className="panel stack" key={c.id}>
          <h2>{c.fullName || c.organization || "名刺"}</h2>
          <p>削除日：{new Date(c.deletedAt!).toLocaleString("ja-JP")}</p>
          <CardActions id={c.id} version={c.version} restore />
        </article>
      ))}
      <nav className="actions" aria-label="ページ移動">
        {page > 1 && (
          <Link
            href={{ pathname: "/settings/trash", query: { page: page - 1 } }}
          >
            前のページ
          </Link>
        )}
        {page * result.limit < result.total && (
          <Link
            href={{ pathname: "/settings/trash", query: { page: page + 1 } }}
          >
            次のページ
          </Link>
        )}
      </nav>
    </main>
  );
}

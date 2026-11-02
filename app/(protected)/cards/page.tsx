import Link from "next/link";
import { requirePageSession } from "@/lib/http";
import { listTeamCards, members } from "@/lib/team-db";
import { cardFilters } from "@/lib/card-filters";
export default async function CardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const s = await requirePageSession("/cards"),
    params = await searchParams,
    query = new URLSearchParams(
      Object.entries(params).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  const filters = cardFilters(query),
    result = await listTeamCards(s, filters),
    people = await members(s);
  return (
    <main className="stack">
      <header className="page-heading">
        <p className="eyebrow">チームの共有連絡先</p>
        <div className="row row--between">
          <h1>共有名刺</h1>
          <Link href="/scan" className="primary-button">
            名刺をスキャン
          </Link>
        </div>
        <p>確認して登録した名刺を、チーム全員で閲覧できます。</p>
      </header>
      <form className="panel stack" action="/cards">
        <div className="field">
          <label htmlFor="card-search">名刺を検索</label>
          <input
            id="card-search"
            name="q"
            defaultValue={filters.q}
            placeholder="名前、所属、役職、メールアドレス"
          />
        </div>
        <div className="filter-grid">
          <div className="field">
            <label htmlFor="creator">登録者</label>
            <select
              id="creator"
              name="createdBy"
              defaultValue={filters.createdBy || ""}
            >
              <option value="">全員</option>
              {people.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="date-from">登録日（開始）</label>
            <input
              id="date-from"
              name="from"
              type="date"
              defaultValue={filters.from}
            />
          </div>
          <div className="field">
            <label htmlFor="date-to">登録日（終了）</label>
            <input
              id="date-to"
              name="to"
              type="date"
              defaultValue={filters.to}
            />
          </div>
        </div>
        <div className="actions">
          <button className="primary-button">検索</button>
          <Link href="/cards" className="secondary-button">
            条件をクリア
          </Link>
          <a className="secondary-button" href={`/api/cards/export?${query}`}>
            検索結果をCSV出力
          </a>
        </div>
      </form>
      {params.trashed === "1" && (
        <p className="success-banner" role="status">
          名刺をごみ箱に移動しました。
          <Link href="/settings/trash">
            30日以内ならごみ箱から復元できます。
          </Link>
        </p>
      )}
      <p role="status">
        {result.total}件の名刺 / {result.page}ページ
      </p>
      {!result.items.length ? (
        <section className="empty-state">
          <h2>
            {filters.q
              ? "条件に一致する名刺がありません"
              : "共有名刺はまだありません"}
          </h2>
          <p>検索条件を変えるか、名刺をスキャンして登録してください。</p>
        </section>
      ) : (
        <div className="card-list">
          {result.items.map((card) => (
            <article className="contact-card" key={card.id}>
              <Link href={`/cards/${card.id}`} className="contact-card__image">
                {card.correctedImageUrl ? (
                  <img
                    src={card.correctedImageUrl}
                    alt={`${card.fullName || card.organization || "名刺"}の画像`}
                    loading="lazy"
                  />
                ) : (
                  <span>画像なし</span>
                )}
              </Link>
              <div className="stack">
                <h2>
                  <Link href={`/cards/${card.id}`}>
                    {card.fullName || card.organization || "名前未入力"}
                  </Link>
                </h2>
                <p>
                  {[card.organization, card.jobTitle]
                    .filter(Boolean)
                    .join(" / ") || "所属・役職未入力"}
                </p>
                {card.email ? (
                  <a href={`mailto:${card.email}`}>{card.email}</a>
                ) : (
                  <p className="hint">メールアドレス未入力</p>
                )}
                <p className="hint">
                  登録者：{card.createdByName}
                  <br />
                  登録日：{new Date(card.createdAt).toLocaleDateString("ja-JP")}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
      <nav className="actions" aria-label="ページ移動">
        {result.page > 1 && (
          <Link
            href={{
              pathname: "/cards",
              query: { ...Object.fromEntries(query), page: result.page - 1 },
            }}
            className="secondary-button"
          >
            前のページ
          </Link>
        )}
        {result.page * result.limit < result.total && (
          <Link
            href={{
              pathname: "/cards",
              query: { ...Object.fromEntries(query), page: result.page + 1 },
            }}
            className="secondary-button"
          >
            次のページ
          </Link>
        )}
      </nav>
    </main>
  );
}

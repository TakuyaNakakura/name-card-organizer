import Link from "next/link";

import { DeleteCardButton } from "@/components/cards/delete-card-button";
import { getDatabaseErrorMessage, listCards } from "@/lib/db";
import { requirePageSession } from "@/lib/http";
import type { CardRecord } from "@/lib/types";

interface CardsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CardsPage({ searchParams }: CardsPageProps) {
  await requirePageSession("/cards");

  const params = await searchParams;
  const search = readSearchParam(params.q)?.trim() ?? "";
  const highlight = readSearchParam(params.highlight) ?? "";
  let cards: CardRecord[] = [];
  let loadError: string | null = null;

  try {
    cards = await listCards(search || undefined);
  } catch (error) {
    console.error("Failed to render cards page", error);
    loadError = getDatabaseErrorMessage(error);
  }

  return (
    <main className="grid">
      <section className="panel hero">
        <span className="brand__eyebrow">Saved Cards</span>
        <h2 className="hero__title">保存済みの名刺一覧</h2>
        <p className="hero__lead">
          名前またはメールアドレスで検索できます。CSV エクスポートは現在の検索条件に追従します。
        </p>
      </section>

      <section className="panel">
        <div className="panel__body stack">
          {loadError ? <div className="status-pill status-pill--warn">{loadError}</div> : null}
          <form className="grid cards-toolbar" action="/cards" method="get">
            <div className="field">
              <label htmlFor="q">検索</label>
              <input
                id="q"
                name="q"
                defaultValue={search}
                placeholder="名前またはメールアドレス"
              />
            </div>
            <div className="inline">
              <button className="primary-button" type="submit">
                検索
              </button>
              <Link className="secondary-button" href="/scan">
                新規スキャン
              </Link>
              <a
                className="ghost-button"
                href={`/api/cards/export${search ? `?q=${encodeURIComponent(search)}` : ""}`}
              >
                CSV エクスポート
              </a>
            </div>
          </form>

          <div className="cards-list">
            {cards.length > 0 ? (
              cards.map((card) => (
                <article
                  className={`card-row ${highlight === card.id ? "card-row--highlight" : ""}`}
                  key={card.id}
                >
                  <img alt={`${card.email} の名刺`} src={card.correctedImageUrl} />
                  <div className="card-row__meta">
                    <h3 className="card-row__title">{card.fullName || "名前未入力"}</h3>
                    <p className="card-row__line">{card.email}</p>
                    <p className="card-row__line">
                      保存日時 {new Date(card.createdAt).toLocaleString("ja-JP")}
                    </p>
                    <p className="card-row__line">
                      抽出確度 {Math.round(card.extractionConfidence * 100)}%
                    </p>
                    <details>
                      <summary>OCR テキスト</summary>
                      <pre className="ocr-text">{card.rawOcrText}</pre>
                    </details>
                    <DeleteCardButton cardId={card.id} />
                  </div>
                </article>
              ))
            ) : (
              <div className="split-banner">
                <p className="section-subtitle">
                  {loadError
                    ? "一覧を読み込めませんでした。DATABASE_URL と DB 接続設定を確認してください。"
                    : "保存済みの名刺はまだありません。まずはスキャン画面から 1 枚取り込んでください。"}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

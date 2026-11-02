import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/http";
import { getCard } from "@/lib/team-db";
import { ApiError, requireUuid } from "@/lib/api-error";
import { CardActions } from "@/components/cards/card-actions";
import { CardEditor } from "@/components/cards/card-editor";
export default async function CardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const s = await requirePageSession("/cards"),
    { id } = await params;
  let card;
  try {
    card = await getCard(s, requireUuid(id));
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 422))
      notFound();
    throw e;
  }
  return (
    <main className="stack">
      <Link href="/cards">共有名刺に戻る</Link>
      <header className="page-heading">
        <h1>{card.fullName || card.organization || "名刺の詳細"}</h1>
        <p>
          登録者：{card.createdByName} / 更新：
          {new Date(card.updatedAt).toLocaleString("ja-JP")}
        </p>
      </header>
      <section className="panel review-grid">
        {card.correctedImageUrl && (
          <a href={card.correctedImageUrl} target="_blank" rel="noreferrer">
            <img
              className="card-preview"
              src={card.correctedImageUrl}
              alt="登録した名刺。画像を開いて拡大"
            />
          </a>
        )}
        <CardEditor card={card} />
      </section>
      <details className="panel">
        <summary>OCRで読み取ったテキスト</summary>
        <pre className="ocr-text">{card.rawOcrText}</pre>
      </details>
      {card.canEdit && <CardActions id={card.id} version={card.version} />}
    </main>
  );
}

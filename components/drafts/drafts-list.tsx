"use client";
import Link from "next/link";
import { useState } from "react";
import { DraftReview } from "./draft-review";
import type { TeamDraft } from "@/lib/team-types";
export function DraftsList({ initialDrafts }: { initialDrafts: TeamDraft[] }) {
  const [drafts, setDrafts] = useState(initialDrafts),
    [notice, setNotice] = useState("");
  return (
    <div className="stack">
      {notice && (
        <p className="success-banner" role="status">
          {notice} <Link href="/cards">共有名刺へ</Link>
        </p>
      )}
      {!drafts.length && (
        <section className="empty-state">
          <h2>未登録の下書きはありません</h2>
          <Link href="/scan">名刺をスキャンする</Link>
        </section>
      )}
      {drafts.map((d) => (
        <DraftReview
          key={d.id}
          draft={d}
          onChange={(next) =>
            setDrafts((list) =>
              list.map((old) => (old.id === next.id ? next : old)),
            )
          }
          onRemove={(id) =>
            setDrafts((list) => list.filter((old) => old.id !== id))
          }
          onRegistered={() => setNotice("名刺をチームに登録しました。")}
        />
      ))}
    </div>
  );
}

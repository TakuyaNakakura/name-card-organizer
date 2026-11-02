import { requirePageSession } from "@/lib/http";
import { listDrafts } from "@/lib/team-db";
import { DraftsList } from "@/components/drafts/drafts-list";
export default async function DraftsPage() {
  const s = await requirePageSession("/drafts"),
    drafts = await listDrafts(s);
  return (
    <main className="stack">
      <header className="page-heading">
        <h1>自分の下書き</h1>
        <p>
          未登録の名刺は自分だけが閲覧できます。最終編集から7日後に削除されます。端末を変えても続きから確認できます。
        </p>
      </header>
      {drafts.some(
        (d) => new Date(d.expiresAt).getTime() - Date.now() < 86400000,
      ) && (
        <p className="notice" role="status">
          24時間以内に期限が切れる下書きがあります。必要な名刺は確認して登録してください。
        </p>
      )}
      <DraftsList initialDrafts={drafts} />
    </main>
  );
}

import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/http";
import { getDraft } from "@/lib/team-db";
import { ApiError, requireUuid } from "@/lib/api-error";
import { DraftsList } from "@/components/drafts/drafts-list";
export default async function DraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const s = await requirePageSession("/drafts");
  let draft;
  try {
    draft = await getDraft(s, requireUuid((await params).id));
  } catch (e) {
    if (e instanceof ApiError) notFound();
    throw e;
  }
  return (
    <main className="stack">
      <h1>下書きの確認</h1>
      <DraftsList initialDrafts={[draft]} />
    </main>
  );
}

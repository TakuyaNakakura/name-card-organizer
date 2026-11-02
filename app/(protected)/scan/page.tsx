import { ScanWorkbench } from "@/components/scan/scan-workbench";
import { requirePageSession } from "@/lib/http";
import { listDrafts } from "@/lib/team-db";
export default async function ScanPage() {
  const session = await requirePageSession("/scan");
  return (
    <main className="stack">
      <header className="page-heading">
        <p className="eyebrow">読み取る → 確認する → チームに登録</p>
        <h1>名刺をスキャン</h1>
        <p>
          自動撮影または画像の選択で取り込みます。共有前に内容を確認できます。
        </p>
      </header>
      <ScanWorkbench initialDrafts={await listDrafts(session)} />
    </main>
  );
}

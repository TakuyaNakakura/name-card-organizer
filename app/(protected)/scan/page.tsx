import { ScanWorkbench } from "@/components/scan/scan-workbench";
import { requirePageSession } from "@/lib/http";

export default async function ScanPage() {
  await requirePageSession("/scan");

  return (
    <main className="grid">
      <section className="panel hero">
        <span className="brand__eyebrow">Capture Workflow</span>
        <h2 className="hero__title">カメラで名刺を取り込み、確認して保存</h2>
        <p className="hero__lead">
          モバイルブラウザで背面カメラを起動し、名刺枠を検出してから OCR を実行します。
          抽出した名前とメールアドレスは保存前に必ず確認できます。
        </p>
      </section>
      <ScanWorkbench />
    </main>
  );
}

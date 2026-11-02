import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/http";
import { teamSql } from "@/lib/team-db";
import { OCR_LIMITS } from "@/lib/ocr-limits";
export default async function OperationsPage() {
  const s = await requirePageSession("/settings/operations");
  if (s.role !== "admin") notFound();
  const sql = teamSql();
  const [usage] =
    await sql`select coalesce(sum(count),0)::int total from name_card.usage_counters where scope=${"team:" + s.teamId} and window_start=date_trunc('hour',now())`;
  const [run] =
    await sql`select * from name_card.maintenance_runs order by completed_at desc limit 1`;
  const events =
    await sql`select a.action,a.target_id,a.created_at,u.name from name_card.audit_events a left join name_card_auth."user" u on u.id=a.actor_id where team_id=${s.teamId} order by a.id desc limit 50`;
  return (
    <main className="stack">
      <header className="page-heading">
        <h1>運用状況</h1>
        <p>管理者向け。APIキーや名刺のOCR原文は表示しません。</p>
      </header>
      <section className="panel stack">
        <h2>読み取り・データ保持</h2>
        <p>
          {`今の時間帯のOCR実行予約：${usage.total} / ${OCR_LIMITS.perTeamPerHour}回（各メンバー${OCR_LIMITS.perMemberPerHour}回まで）`}
        </p>
        <p>
          下書き7日、ごみ箱30日、操作履歴1年。再解析は1回のOCRとして数えます。
        </p>
        <p>
          最終クリーンアップ：
          {run ? new Date(run.completed_at).toLocaleString("ja-JP") : "未実行"}
        </p>
        {run && (
          <p>
            画像削除：{run.deleted_assets}件 / 失敗：{run.failed_assets}件
          </p>
        )}
        {(!run ||
          Date.now() - new Date(run.completed_at).getTime() > 36 * 3600000) && (
          <p className="error-banner" role="status">
            クリーンアップが未実行、または36時間以上実行されていません。Cron設定を確認してください。
          </p>
        )}
      </section>
      <section className="panel stack">
        <h2>最近の操作</h2>
        <div className="table-scroll">
          <table>
            <caption>直近50件の操作履歴</caption>
            <thead>
              <tr>
                <th scope="col">日時</th>
                <th scope="col">実行者</th>
                <th scope="col">操作</th>
                <th scope="col">対象ID</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i}>
                  <td>{new Date(e.created_at).toLocaleString("ja-JP")}</td>
                  <td>{e.name || "システム"}</td>
                  <td>{e.action}</td>
                  <td>{e.target_id || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

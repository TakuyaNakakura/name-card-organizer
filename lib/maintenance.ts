import { teamSql } from "@/lib/team-db";
import { getStorage } from "@/lib/storage";
export async function runMaintenance() {
  const sql = teamSql();
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as typeof sql;
    const [lock] = await tx`select pg_try_advisory_xact_lock(497300292) locked`;
    if (!lock.locked)
      return { skipped: true, deletedAssets: 0, failedAssets: 0 };
    await tx`update name_card.drafts set status='failed',error_code='PROCESS_INTERRUPTED',error_message='読み取りが中断されました。再解析または撮り直しができます。',lease_until=null,version=version+1
      where status='processing' and lease_until<now()`;
    const expired =
      await tx`select a.id,a.storage_key from name_card.assets a left join name_card.cards c on c.id=a.card_id left join name_card.drafts d on d.id=a.draft_id
      where (c.deleted_at<now()-interval '30 days') or (a.card_id is null and d.expires_at<now() and d.status<>'confirmed' and (d.lease_until is null or d.lease_until<now()))
      order by a.created_at limit 25 for update of a skip locked`;
    let deletedAssets = 0,
      failedAssets = 0;
    for (const asset of expired) {
      try {
        await getStorage().deleteObject(asset.storage_key);
      } catch {
        failedAssets++;
        continue;
      }
      await tx`delete from name_card.assets where id=${asset.id}`;
      deletedAssets++;
    }
    await tx`delete from name_card.cards c where deleted_at<now()-interval '30 days' and not exists(select 1 from name_card.assets a where a.card_id=c.id)`;
    await tx`delete from name_card.drafts d where expires_at<now() and (lease_until is null or lease_until<now())
      and not exists(select 1 from name_card.assets a where a.draft_id=d.id) and not exists(select 1 from name_card.cards c where c.source_draft_id=d.id)`;
    await tx`delete from name_card.usage_counters where window_start<now()-interval '7 days'`;
    await tx`delete from name_card_auth.session where "expiresAt"<now()`;
    await tx`delete from name_card_auth.verification where "expiresAt"<now()`;
    await tx`delete from name_card.audit_events where created_at<now()-interval '1 year'`;
    await tx`insert into name_card.maintenance_runs(deleted_assets,failed_assets) values(${deletedAssets},${failedAssets})`;
    await tx`delete from name_card.maintenance_runs where completed_at<now()-interval '90 days'`;
    return { deletedAssets, failedAssets };
  });
}

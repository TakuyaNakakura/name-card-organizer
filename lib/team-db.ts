import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { ApiError } from "@/lib/api-error";
import { getRequiredEnv } from "@/lib/env";
import { contactFieldErrors } from "@/lib/contact-fields";
import { OCR_LIMITS } from "@/lib/ocr-limits";
import type {
  ContactFields,
  TeamCard,
  TeamDraft,
  TeamSession,
} from "@/lib/team-types";

let database: Sql | undefined;
export function teamSql() {
  return (database ??= postgres(getRequiredEnv("DATABASE_URL"), {
    max: process.env.VERCEL ? 1 : 4,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
  }));
}

function transaction<T>(work: (tx: Sql) => Promise<T>): Promise<T> {
  // postgres.js' transaction type omits the callable tag signature.
  return teamSql().begin((tx) => work(tx as unknown as Sql)) as Promise<T>;
}

type Row = Record<string, any>;
const iso = (value: Date | string) => new Date(value).toISOString();
const assetUrl = (id: string | null) => (id ? `/api/assets/${id}` : "");
const draftAssets = () => teamSql()`
  (select id from name_card.assets where draft_id=d.id and kind='original') original_asset_id,
  (select id from name_card.assets where draft_id=d.id and kind='corrected') corrected_asset_id,
  (select id from name_card.cards where source_draft_id=d.id) card_id
`;
function draftRecord(row: Row): TeamDraft {
  return {
    id: row.id,
    clientScanId: row.client_scan_id,
    status: row.status,
    version: row.version,
    fullName: row.full_name || "",
    organization: row.organization || "",
    jobTitle: row.job_title || "",
    email: row.email || "",
    originalImageUrl: assetUrl(row.original_asset_id),
    correctedImageUrl: assetUrl(row.corrected_asset_id),
    rawOcrText: row.raw_ocr_text,
    confidence: row.confidence,
    warnings: Array.isArray(row.warnings)
      ? row.warnings.filter((v: unknown): v is string => typeof v === "string")
      : [],
    errorMessage: row.error_message,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    cardId: row.card_id || null,
  };
}
function cardRecord(row: Row, session: TeamSession): TeamCard {
  return {
    id: row.id,
    fullName: row.full_name || "",
    organization: row.organization || "",
    jobTitle: row.job_title || "",
    email: row.email || "",
    createdBy: row.created_by,
    createdByName: row.author_name || "旧版から移行",
    originalImageUrl: assetUrl(row.original_asset_id),
    correctedImageUrl: assetUrl(row.corrected_asset_id),
    rawOcrText: row.raw_ocr_text,
    extractionConfidence: row.extraction_confidence,
    status: "confirmed",
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deletedAt: row.deleted_at ? iso(row.deleted_at) : null,
    canEdit: session.role === "admin" || row.created_by === session.userId,
  };
}
const cardColumns = () => teamSql()`c.*, u.name author_name,
  (select id from name_card.assets where card_id=c.id and kind='original' limit 1) original_asset_id,
  (select id from name_card.assets where card_id=c.id and kind='corrected' limit 1) corrected_asset_id`;

export async function invited(email: string) {
  const rows =
    await teamSql()`select 1 from name_card.invitations where email=${email.toLowerCase()} and revoked_at is null and accepted_at is null and expires_at>now()`;
  return rows.length > 0;
}

export async function acceptInvitation(userId: string, email: string) {
  const sql = teamSql();
  return transaction(async (tx) => {
    const [existing] =
      await tx`select m.*,t.name team_name from name_card.memberships m join name_card.teams t on t.id=m.team_id where user_id=${userId}`;
    if (existing) return existing.status === "active";
    const [invite] =
      await tx`select * from name_card.invitations where email=${email.toLowerCase()} and revoked_at is null and accepted_at is null and expires_at>now() for update`;
    if (!invite) return false;
    await tx`insert into name_card.memberships(team_id,user_id,role) values(${invite.team_id},${userId},${invite.role})`;
    await tx`update name_card.invitations set accepted_at=now() where id=${invite.id}`;
    await tx`insert into name_card.audit_events(team_id,actor_id,action,target_id) values(${invite.team_id},${userId},'member.join',${userId})`;
    return true;
  });
}

export async function sessionForUser(
  userId: string,
): Promise<TeamSession | null> {
  const [r] =
    await teamSql()`select m.*,u.name,u.email,u.username,t.name team_name from name_card.memberships m
    join name_card_auth."user" u on u.id=m.user_id join name_card.teams t on t.id=m.team_id
    where user_id=${userId} and status='active'`;
  return r
    ? {
        userId,
        teamId: r.team_id,
        name: r.name,
        email: r.email,
        role: r.role,
        teamName: r.team_name,
        username: r.username,
        passwordChangeRequired: r.password_change_required,
      }
    : null;
}

export async function listDrafts(s: TeamSession): Promise<TeamDraft[]> {
  const rows =
    await teamSql()`select d.*,${draftAssets()} from name_card.drafts d where team_id=${s.teamId} and owner_id=${s.userId}
    and status in ('ready','processing','failed') and expires_at>now() order by created_at desc limit 100`;
  return rows.map(draftRecord);
}
export async function getDraft(s: TeamSession, id: string) {
  const [row] =
    await teamSql()`select d.*,${draftAssets()} from name_card.drafts d where id=${id} and team_id=${s.teamId} and owner_id=${s.userId}
    and status<>'discarded' and (expires_at>now() or status='confirmed')`;
  if (!row)
    throw new ApiError(
      404,
      "DRAFT_NOT_FOUND",
      "下書きが見つからないか、有効期限が切れています。",
    );
  const draft = draftRecord(row);
  if (
    draft.status === "ready" &&
    (draft.email || (draft.fullName && draft.organization))
  ) {
    const duplicates =
      await teamSql()`select id from name_card.cards where team_id=${s.teamId} and deleted_at is null and
      ((${draft.email}<>'' and lower(email)=lower(${draft.email})) or (${draft.fullName}<>'' and ${draft.organization}<>'' and full_name=${draft.fullName} and organization=${draft.organization})) limit 1`;
    if (duplicates.length)
      draft.warnings = [
        ...draft.warnings,
        "同じメールアドレス、または同じ名前と所属の名刺が共有一覧にあります。重複を確認してください。",
      ];
  }
  return draft;
}
export async function reserveDraft(s: TeamSession, clientId: string) {
  const sql = teamSql();
  return transaction(async (tx) => {
    // A per-user transaction lock makes the concurrent processing limit atomic.
    await tx`select pg_advisory_xact_lock(hashtext(${s.userId}))`;
    const [old] =
      await tx`select id from name_card.drafts where team_id=${s.teamId} and owner_id=${s.userId} and client_scan_id=${clientId}`;
    if (old) return { id: String(old.id), created: false };
    const [count] =
      await tx`select count(*)::int total from name_card.drafts where team_id=${s.teamId} and owner_id=${s.userId} and status in ('processing','ready','failed') and expires_at>now()`;
    if (count.total >= 100)
      throw new ApiError(
        429,
        "DRAFT_LIMIT",
        "下書きの上限は100件です。登録または破棄してから読み取ってください。",
      );
    const [busy] =
      await tx`select id from name_card.drafts where owner_id=${s.userId} and status='processing' and lease_until>now()`;
    if (busy)
      throw new ApiError(
        409,
        "SCAN_BUSY",
        "別の名刺を読み取り中です。完了するまでお待ちください。",
      );
    const id = randomUUID();
    await tx`insert into name_card.drafts(id,team_id,owner_id,client_scan_id,lease_until) values(${id},${s.teamId},${s.userId},${clientId},now()+interval '90 seconds')`;
    return { id, created: true };
  });
}
export async function addDraftAsset(
  s: TeamSession,
  draftId: string,
  kind: "original" | "corrected",
  size: number,
  contentType: string,
) {
  const id = randomUUID(),
    key = `teams/${s.teamId}/drafts/${draftId}/${id}`;
  await teamSql()`insert into name_card.assets(id,team_id,draft_id,kind,storage_key,content_type,byte_size)
    values(${id},${s.teamId},${draftId},${kind},${key},${contentType},${size})`;
  return key;
}
export async function completeDraft(
  s: TeamSession,
  id: string,
  fields: ContactFields,
  rawText: string,
  confidence: number,
  warnings: string[],
) {
  await teamSql()`update name_card.drafts set full_name=${fields.fullName},organization=${fields.organization},job_title=${fields.jobTitle},email=${fields.email},
    raw_ocr_text=${rawText},confidence=${confidence},warnings=${teamSql().json(warnings)},status='ready',lease_until=null,version=version+1,updated_at=now()
    where id=${id} and team_id=${s.teamId} and owner_id=${s.userId} and status='processing'`;
  return getDraft(s, id);
}
export async function failDraft(
  s: TeamSession,
  id: string,
  code: string,
  message: string,
) {
  await teamSql()`update name_card.drafts set status='failed',error_code=${code},error_message=${message},lease_until=null,updated_at=now(),version=version+1
    where id=${id} and team_id=${s.teamId} and owner_id=${s.userId} and status='processing'`;
}
export async function editDraft(
  s: TeamSession,
  id: string,
  version: number,
  fields: ContactFields,
) {
  const rows =
    await teamSql()`update name_card.drafts set full_name=${fields.fullName},organization=${fields.organization},job_title=${fields.jobTitle},email=${fields.email},
    version=version+1,updated_at=now(),expires_at=now()+interval '7 days'
    where id=${id} and team_id=${s.teamId} and owner_id=${s.userId} and version=${version} and status in ('ready','failed') and expires_at>now() returning id`;
  if (!rows.length) {
    await getDraft(s, id);
    throw new ApiError(
      409,
      "VERSION_CONFLICT",
      "別の画面で下書きが変更されています。入力を控えてから最新の内容を読み込んでください。",
    );
  }
  return getDraft(s, id);
}
export async function discardDraft(s: TeamSession, id: string) {
  const rows =
    await teamSql()`update name_card.drafts set status='discarded',expires_at=now(),version=version+1 where id=${id} and team_id=${s.teamId}
    and owner_id=${s.userId} and status in ('ready','failed') returning id`;
  if (!rows.length)
    throw new ApiError(
      404,
      "DRAFT_NOT_FOUND",
      "破棄できる下書きが見つかりません。",
    );
}
export async function retryDraftLease(s: TeamSession, id: string) {
  await getDraft(s, id);
  const sql = teamSql();
  await transaction(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${s.userId}))`;
    const [busy] =
      await tx`select id from name_card.drafts where owner_id=${s.userId} and status='processing' and lease_until>now()`;
    if (busy)
      throw new ApiError(
        409,
        "SCAN_BUSY",
        "別の読み取りが完了するまでお待ちください。",
      );
    const rows =
      await tx`update name_card.drafts set status='processing',lease_until=now()+interval '90 seconds',error_message=null,error_code=null,version=version+1
      where id=${id} and team_id=${s.teamId} and owner_id=${s.userId} and (status='failed' or (status='processing' and lease_until<now())) returning id`;
    if (!rows.length)
      throw new ApiError(
        409,
        "DRAFT_NOT_RETRYABLE",
        "この下書きは再解析できません。",
      );
  });
}

export async function confirmDraft(
  s: TeamSession,
  id: string,
  version: number,
): Promise<TeamCard> {
  const sql = teamSql();
  const cardId = await transaction(async (tx) => {
    const [d] =
      await tx`select * from name_card.drafts where id=${id} and team_id=${s.teamId} and owner_id=${s.userId} for update`;
    if (!d)
      throw new ApiError(404, "DRAFT_NOT_FOUND", "下書きが見つかりません。");
    const [saved] =
      await tx`select id from name_card.cards where source_draft_id=${id}`;
    if (saved) return String(saved.id);
    if (d.status !== "ready" || new Date(d.expires_at) < new Date())
      throw new ApiError(
        409,
        "DRAFT_NOT_READY",
        "読み取り完了後、有効な下書きを登録してください。",
      );
    if (d.version !== version)
      throw new ApiError(
        409,
        "VERSION_CONFLICT",
        "下書きが変更されています。最新の内容を確認してください。",
      );
    const fields = {
      fullName: d.full_name || "",
      organization: d.organization || "",
      jobTitle: d.job_title || "",
      email: d.email || "",
    };
    const errors = contactFieldErrors(fields);
    if (Object.keys(errors).length)
      throw new ApiError(422, "INVALID_CONTACT", Object.values(errors)[0]);
    const newId = randomUUID();
    await tx`insert into name_card.cards(id,team_id,created_by,updated_by,source_draft_id,full_name,organization,job_title,email,raw_ocr_text,extraction_confidence)
      values(${newId},${s.teamId},${s.userId},${s.userId},${id},${d.full_name},${d.organization},${d.job_title},${d.email},${d.raw_ocr_text},${d.confidence})`;
    await tx`update name_card.assets set card_id=${newId} where draft_id=${id} and team_id=${s.teamId}`;
    await tx`update name_card.drafts set status='confirmed',version=version+1,updated_at=now() where id=${id}`;
    await tx`insert into name_card.audit_events(team_id,actor_id,action,target_id) values(${s.teamId},${s.userId},'card.create',${newId})`;
    return newId;
  });
  return getCard(s, cardId, true);
}

export interface CardFilters {
  q?: string;
  createdBy?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  trash?: boolean;
}
export async function listTeamCards(s: TeamSession, filters: CardFilters = {}) {
  const sql = teamSql(),
    q = (filters.q || "").trim(),
    page = Math.max(1, Math.min(filters.page || 1, 10000)),
    limit = Math.max(1, Math.min(filters.limit || 25, 100));
  const parts = [sql`c.team_id=${s.teamId}`];
  parts.push(
    filters.trash
      ? sql`c.deleted_at>now()-interval '30 days' and (${s.role}='admin' or c.created_by=${s.userId})`
      : sql`c.deleted_at is null`,
  );
  if (q)
    parts.push(
      sql`concat_ws(' ',c.full_name,c.organization,c.job_title,c.email) ilike ${"%" + q.replace(/[\\%_]/g, "\\$&") + "%"}`,
    );
  if (filters.createdBy) parts.push(sql`c.created_by=${filters.createdBy}`);
  if (filters.from) parts.push(sql`c.created_at>=${filters.from}::date`);
  if (filters.to)
    parts.push(sql`c.created_at<${filters.to}::date+interval '1 day'`);
  const where = parts.reduce((a, b) => sql`${a} and ${b}`);
  const rows =
    await sql`select ${cardColumns()} from name_card.cards c left join name_card_auth."user" u on u.id=c.created_by
    where ${where} order by c.created_at desc,c.id desc limit ${limit} offset ${(page - 1) * limit}`;
  const [count] =
    await sql`select count(*)::int total from name_card.cards c where ${where}`;
  return {
    items: rows.map((row) => cardRecord(row, s)),
    total: Number(count.total),
    page,
    limit,
  };
}
export async function getCard(
  s: TeamSession,
  id: string,
  includeDeleted = false,
): Promise<TeamCard> {
  const [row] =
    await teamSql()`select ${cardColumns()} from name_card.cards c left join name_card_auth."user" u on u.id=c.created_by
    where c.id=${id} and c.team_id=${s.teamId} and (c.deleted_at is null or (${includeDeleted} and (${s.role}='admin' or c.created_by=${s.userId})))`;
  if (!row) throw new ApiError(404, "CARD_NOT_FOUND", "名刺が見つかりません。");
  return cardRecord(row, s);
}
export async function editCard(
  s: TeamSession,
  id: string,
  version: number,
  fields: ContactFields,
) {
  const errors = contactFieldErrors(fields);
  if (Object.keys(errors).length)
    throw new ApiError(422, "INVALID_CONTACT", Object.values(errors)[0]);
  const sql = teamSql();
  await transaction(async (tx) => {
    const [r] =
      await tx`update name_card.cards set full_name=${fields.fullName},organization=${fields.organization},job_title=${fields.jobTitle},email=${fields.email},
      version=version+1,updated_at=now(),updated_by=${s.userId} where id=${id} and team_id=${s.teamId} and deleted_at is null and version=${version}
      and (created_by=${s.userId} or ${s.role}='admin') returning id`;
    if (!r) {
      const [card] =
        await tx`select created_by from name_card.cards where id=${id} and team_id=${s.teamId} and deleted_at is null`;
      if (!card)
        throw new ApiError(404, "CARD_NOT_FOUND", "名刺が見つかりません。");
      if (s.role !== "admin" && card.created_by !== s.userId)
        throw new ApiError(
          403,
          "FORBIDDEN",
          "登録者または管理者だけが編集できます。",
        );
      throw new ApiError(
        409,
        "VERSION_CONFLICT",
        "他の画面で更新されています。入力を控えてから最新の内容を確認してください。",
      );
    }
    await tx`insert into name_card.audit_events(team_id,actor_id,action,target_id) values(${s.teamId},${s.userId},'card.update',${id})`;
  });
  return getCard(s, id);
}
export async function setCardDeleted(
  s: TeamSession,
  id: string,
  version: number,
  restore = false,
) {
  const sql = teamSql();
  await transaction(async (tx) => {
    const [row] =
      await tx`select * from name_card.cards where id=${id} and team_id=${s.teamId} for update`;
    if (!row)
      throw new ApiError(404, "CARD_NOT_FOUND", "名刺が見つかりません。");
    if (s.role !== "admin" && row.created_by !== s.userId)
      throw new ApiError(
        403,
        "FORBIDDEN",
        "登録者または管理者だけが操作できます。",
      );
    if (row.version !== version)
      throw new ApiError(
        409,
        "VERSION_CONFLICT",
        "他の画面で更新されています。再読み込みしてください。",
      );
    if (
      restore &&
      (!row.deleted_at ||
        Date.now() - new Date(row.deleted_at).getTime() > 30 * 86400000)
    )
      throw new ApiError(
        409,
        "RESTORE_EXPIRED",
        "復元できる期間を過ぎています。",
      );
    await tx`update name_card.cards set deleted_at=${restore ? null : new Date()},deleted_by=${restore ? null : s.userId},updated_at=now(),version=version+1 where id=${id}`;
    await tx`insert into name_card.audit_events(team_id,actor_id,action,target_id) values(${s.teamId},${s.userId},${restore ? "card.restore" : "card.trash"},${id})`;
  });
}
export async function authorizedAsset(s: TeamSession, id: string) {
  const [asset] =
    await teamSql()`select a.* from name_card.assets a left join name_card.cards c on c.id=a.card_id left join name_card.drafts d on d.id=a.draft_id
    where a.id=${id} and a.team_id=${s.teamId} and ((c.id is not null and c.deleted_at is null and c.team_id=${s.teamId})
    or (a.card_id is null and d.owner_id=${s.userId} and d.team_id=${s.teamId} and d.expires_at>now() and d.status<>'discarded'))`;
  if (!asset)
    throw new ApiError(404, "ASSET_NOT_FOUND", "画像が見つかりません。");
  return asset;
}
export async function consumeScanQuota(s: TeamSession) {
  const sql = teamSql();
  await transaction(async (tx) => {
    for (const [scope, limit] of [
      [`user:${s.userId}`, OCR_LIMITS.perMemberPerHour],
      [`team:${s.teamId}`, OCR_LIMITS.perTeamPerHour],
    ] as const) {
      const [r] =
        await tx`insert into name_card.usage_counters(scope,window_start,count) values(${scope},date_trunc('hour',now()),1)
        on conflict(scope,window_start) do update set count=name_card.usage_counters.count+1 returning count`;
      if (r.count > limit)
        throw new ApiError(
          429,
          "SCAN_LIMIT",
          "読み取り回数の上限に達しました。次の時間帯に再試行してください。",
        );
    }
  });
}
export async function members(s: TeamSession) {
  return teamSql()`select m.user_id,m.role,m.status,m.password_change_required,u.name,u.email,u.username from name_card.memberships m join name_card_auth."user" u on u.id=m.user_id where team_id=${s.teamId} order by m.created_at`;
}
export async function invitations(s: TeamSession) {
  return teamSql()`select id,email,role,expires_at,accepted_at,revoked_at from name_card.invitations where team_id=${s.teamId} order by created_at desc`;
}
export async function inviteMember(
  s: TeamSession,
  email: string,
  role: "admin" | "member",
) {
  if (s.role !== "admin")
    throw new ApiError(403, "FORBIDDEN", "管理者だけが招待できます。");
  await teamSql()`insert into name_card.invitations(id,team_id,email,role,expires_at,created_by) values(${randomUUID()},${s.teamId},${email},${role},now()+interval '7 days',${s.userId})
    on conflict(team_id,email) do update set role=excluded.role,expires_at=excluded.expires_at,revoked_at=null,accepted_at=null`;
}
export async function changeMember(
  s: TeamSession,
  userId: string,
  role: "admin" | "member",
  status: "active" | "suspended",
) {
  if (s.role !== "admin")
    throw new ApiError(403, "FORBIDDEN", "管理者だけが変更できます。");
  await transaction(async (tx) => {
    await tx`select id from name_card.teams where id=${s.teamId} for update`;
    const [member] =
      await tx`select * from name_card.memberships where team_id=${s.teamId} and user_id=${userId}`;
    if (!member)
      throw new ApiError(404, "MEMBER_NOT_FOUND", "メンバーが見つかりません。");
    if (
      member.role === "admin" &&
      member.status === "active" &&
      (role !== "admin" || status !== "active")
    ) {
      const [count] =
        await tx`select count(*)::int total from name_card.memberships where team_id=${s.teamId} and role='admin' and status='active'`;
      if (count.total <= 1)
        throw new ApiError(
          409,
          "LAST_ADMIN",
          "最後の管理者は停止・降格できません。",
        );
    }
    await tx`update name_card.memberships set role=${role},status=${status} where team_id=${s.teamId} and user_id=${userId}`;
    if (status === "suspended")
      await tx`delete from name_card_auth.session where "userId"=${userId}`;
    await tx`insert into name_card.audit_events(team_id,actor_id,action,target_id) values(${s.teamId},${s.userId},'member.update',${userId})`;
  });
}
export async function revokeInvitation(s: TeamSession, id: string) {
  if (s.role !== "admin")
    throw new ApiError(403, "FORBIDDEN", "管理者だけが変更できます。");
  await teamSql()`update name_card.invitations set revoked_at=now() where id=${id} and team_id=${s.teamId} and accepted_at is null`;
}
export async function audit(
  s: TeamSession,
  action: string,
  target: string | null = null,
) {
  await teamSql()`insert into name_card.audit_events(team_id,actor_id,action,target_id) values(${s.teamId},${s.userId},${action},${target})`;
}

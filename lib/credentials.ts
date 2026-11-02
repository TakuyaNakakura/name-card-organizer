import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import type { Sql } from "postgres";
import { ApiError } from "@/lib/api-error";
import {
  normalizeUsername,
  validPassword,
  validUsername,
} from "@/lib/credential-policy";
import { teamSql } from "@/lib/team-db";
import type { TeamSession } from "@/lib/team-types";

export async function consumeCredentialAttempt(scope: string, limit = 10) {
  const key = "credentials:" + createHash("sha256").update(scope).digest("hex");
  const rows =
    await teamSql()`insert into name_card.usage_counters(scope,window_start,count)
    values(${key},to_timestamp(floor(extract(epoch from now())/900)*900),1)
    on conflict(scope,window_start) do update set count=name_card.usage_counters.count+1
    where name_card.usage_counters.count<${limit} returning count`;
  if (!rows.length)
    throw new ApiError(
      429,
      "CREDENTIAL_RATE_LIMIT",
      "試行回数が上限に達しました。15分ほど待ってから再試行してください。",
    );
}

async function adminInTransaction(tx: Sql, s: TeamSession) {
  await tx`select id from name_card.teams where id=${s.teamId} for update`;
  const [actor] =
    await tx`select role,status,password_change_required from name_card.memberships where team_id=${s.teamId} and user_id=${s.userId}`;
  if (
    actor?.role !== "admin" ||
    actor.status !== "active" ||
    actor.password_change_required
  )
    throw new ApiError(403, "FORBIDDEN", "有効な管理者だけが操作できます。");
}

function transaction<T>(work: (tx: Sql) => Promise<T>): Promise<T> {
  return teamSql().begin((tx) => work(tx as unknown as Sql)) as Promise<T>;
}

function requireLoginId(value: unknown) {
  const id = typeof value === "string" ? normalizeUsername(value) : "";
  if (!validUsername(id))
    throw new ApiError(
      422,
      "INVALID_USERNAME",
      "ユーザーIDは3〜32文字の半角英数字・ハイフン・アンダースコア・ピリオドで入力してください。先頭は英数字です。",
    );
  return id;
}

function uniqueError(error: unknown): never {
  if ((error as { code?: string })?.code === "23505")
    throw new ApiError(
      409,
      "USERNAME_TAKEN",
      "このユーザーIDは既に使われています。",
    );
  throw error;
}

export async function createPasswordMember(
  s: TeamSession,
  input: Record<string, unknown>,
) {
  if (s.role !== "admin")
    throw new ApiError(403, "FORBIDDEN", "管理者だけが利用できます。");
  const username = requireLoginId(input.username);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (
    !name ||
    name.length > 80 ||
    !["admin", "member"].includes(String(input.role))
  )
    throw new ApiError(
      422,
      "INVALID_MEMBER",
      "表示名（80文字以内）と権限を確認してください。",
    );
  await consumeCredentialAttempt(`admin:${s.userId}`, 30);
  const password = randomBytes(18).toString("base64url"),
    hash = await hashPassword(password),
    userId = randomUUID();
  try {
    await transaction(async (tx) => {
      await adminInTransaction(tx, s);
      await tx`insert into name_card_auth."user"(id,name,email,username) values(${userId},${name},${userId + "@users.invalid"},${username})`;
      await tx`insert into name_card_auth.account(id,"accountId","providerId","userId",password) values(${randomUUID()},${userId},'credential',${userId},${hash})`;
      await tx`insert into name_card.memberships(team_id,user_id,role,password_change_required) values(${s.teamId},${userId},${String(input.role)},true)`;
      await tx`insert into name_card.audit_events(team_id,actor_id,action,target_id) values(${s.teamId},${s.userId},'member.create-password',${userId})`;
    });
  } catch (error) {
    uniqueError(error);
  }
  return { userId, username, temporaryPassword: password };
}

export async function resetMemberPassword(
  s: TeamSession,
  userId: string,
  loginId?: unknown,
) {
  if (s.role !== "admin")
    throw new ApiError(403, "FORBIDDEN", "管理者だけが利用できます。");
  if (s.userId === userId)
    throw new ApiError(
      422,
      "USE_PASSWORD_CHANGE",
      "自分のパスワードは「アカウント」画面で変更してください。",
    );
  const requestedId =
    loginId === undefined ? undefined : requireLoginId(loginId);
  await consumeCredentialAttempt(`admin:${s.userId}`, 30);
  const password = randomBytes(18).toString("base64url"),
    hash = await hashPassword(password);
  let username = "";
  try {
    await transaction(async (tx) => {
      await adminInTransaction(tx, s);
      const [member] =
        await tx`select u.username,m.status from name_card.memberships m join name_card_auth."user" u on u.id=m.user_id
        where m.team_id=${s.teamId} and m.user_id=${userId} for update of m,u`;
      if (!member)
        throw new ApiError(
          404,
          "MEMBER_NOT_FOUND",
          "メンバーが見つかりません。",
        );
      if (member.status !== "active")
        throw new ApiError(
          409,
          "MEMBER_SUSPENDED",
          "利用を再開してから再発行してください。",
        );
      username = member.username || requestedId || "";
      if (!username)
        throw new ApiError(
          422,
          "USERNAME_REQUIRED",
          "このメンバーに割り当てるユーザーIDを入力してください。",
        );
      if (member.username && requestedId && member.username !== requestedId)
        throw new ApiError(
          409,
          "USERNAME_IMMUTABLE",
          "既存のユーザーIDは変更できません。",
        );
      await tx`update name_card_auth."user" set username=${username},"updatedAt"=now() where id=${userId}`;
      await tx`insert into name_card_auth.account(id,"accountId","providerId","userId",password)
        values(${randomUUID()},${userId},'credential',${userId},${hash})
        on conflict("providerId","accountId") do update set password=excluded.password,"updatedAt"=now()`;
      await tx`update name_card.memberships set password_change_required=true where user_id=${userId} and team_id=${s.teamId}`;
      await tx`delete from name_card_auth.session where "userId"=${userId}`;
      await tx`insert into name_card.audit_events(team_id,actor_id,action,target_id) values(${s.teamId},${s.userId},'member.reset-password',${userId})`;
    });
  } catch (error) {
    uniqueError(error);
  }
  return { userId, username, temporaryPassword: password };
}

export async function changeOwnPassword(
  s: TeamSession,
  input: Record<string, unknown>,
) {
  if (
    !validPassword(input.newPassword) ||
    typeof input.currentPassword !== "string" ||
    input.currentPassword.length > 128
  )
    throw new ApiError(
      422,
      "INVALID_PASSWORD",
      "現在のパスワードと、12〜128文字の新しいパスワードを入力してください。",
    );
  if (input.currentPassword === input.newPassword)
    throw new ApiError(
      422,
      "PASSWORD_UNCHANGED",
      "現在とは異なるパスワードを設定してください。",
    );
  await consumeCredentialAttempt(`change:${s.userId}`);
  await transaction(async (tx) => {
    // Use the same lock order as resets and suspensions; password + revocation commit together.
    await tx`select id from name_card.teams where id=${s.teamId} for update`;
    const [member] =
      await tx`select status from name_card.memberships where team_id=${s.teamId} and user_id=${s.userId} for update`;
    if (member?.status !== "active")
      throw new ApiError(403, "FORBIDDEN", "利用が停止されています。");
    const [account] =
      await tx`select id,password from name_card_auth.account where "userId"=${s.userId} and "providerId"='credential' for update`;
    if (
      !account?.password ||
      !(await verifyPassword({
        hash: account.password,
        password: input.currentPassword as string,
      }))
    )
      throw new ApiError(
        422,
        "INVALID_CURRENT_PASSWORD",
        "現在のパスワードが正しくありません。",
      );
    const hash = await hashPassword(input.newPassword as string);
    await tx`update name_card_auth.account set password=${hash},"updatedAt"=now() where id=${account.id}`;
    await tx`update name_card.memberships set password_change_required=false where team_id=${s.teamId} and user_id=${s.userId}`;
    await tx`delete from name_card_auth.session where "userId"=${s.userId}`;
    await tx`insert into name_card.audit_events(team_id,actor_id,action,target_id) values(${s.teamId},${s.userId},'member.change-password',${s.userId})`;
  });
}

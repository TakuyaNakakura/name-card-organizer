import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/http";
import { members, invitations } from "@/lib/team-db";
import { MemberSettings } from "@/components/settings/members";
import { getTeamAuthMode } from "@/lib/auth-config";
export default async function MembersPage() {
  const s = await requirePageSession("/settings/members");
  if (s.role !== "admin") notFound();
  const mode = getTeamAuthMode();
  const people = await members(s),
    pending = mode === "google" ? await invitations(s) : [];
  return (
    <main className="stack">
      <header className="page-heading">
        <h1>チームメンバー</h1>
        <p>
          メンバーの追加・権限変更・利用停止は管理者だけが行えます。最後の管理者は停止・降格できません。
        </p>
      </header>
      <MemberSettings
        mode={mode}
        currentUserId={s.userId}
        members={people.map((m) => ({
          user_id: String(m.user_id),
          name: String(m.name),
          email: String(m.email),
          role: m.role,
          status: m.status,
          username: m.username || null,
          password_change_required: Boolean(m.password_change_required),
        }))}
        invitations={pending.map((i) => ({
          id: String(i.id),
          email: String(i.email),
          role: String(i.role),
          expires_at: new Date(i.expires_at).toISOString(),
          accepted_at: i.accepted_at
            ? new Date(i.accepted_at).toISOString()
            : null,
          revoked_at: i.revoked_at
            ? new Date(i.revoked_at).toISOString()
            : null,
        }))}
      />
    </main>
  );
}

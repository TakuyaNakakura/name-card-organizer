import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { hashPassword } from "better-auth/crypto";
import {
  normalizeUsername,
  validPassword,
  validUsername,
} from "../lib/credential-policy.ts";

const mode = process.env.TEAM_AUTH_MODE || "password";
if (!["password", "google"].includes(mode))
  throw new Error("TEAM_AUTH_MODE must be password or google");
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
if (mode === "google" && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
  throw new Error("Set BOOTSTRAP_ADMIN_EMAIL explicitly");
const username = normalizeUsername(process.env.BOOTSTRAP_ADMIN_USERNAME || "");
if (
  mode === "password" &&
  (!validUsername(username) ||
    !validPassword(process.env.BOOTSTRAP_ADMIN_PASSWORD))
)
  throw new Error(
    "Set BOOTSTRAP_ADMIN_USERNAME (3-32 ASCII characters) and BOOTSTRAP_ADMIN_PASSWORD (12-128 characters)",
  );
if (!process.env.DATABASE_MIGRATION_URL)
  throw new Error("DATABASE_MIGRATION_URL is required");
const sql = postgres(process.env.DATABASE_MIGRATION_URL, {
  max: 1,
  prepare: false,
});
try {
  const passwordHash =
    mode === "password"
      ? await hashPassword(process.env.BOOTSTRAP_ADMIN_PASSWORD)
      : null;
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(497300291)`;
    const existingEmail =
      process.env.BOOTSTRAP_EXISTING_ADMIN_EMAIL?.trim().toLowerCase() || "";
    const existingUsername = normalizeUsername(
      process.env.BOOTSTRAP_EXISTING_ADMIN_USERNAME || "",
    );
    if (existingEmail && existingUsername)
      throw new Error(
        "Select the existing administrator by email OR username, not both",
      );
    if (mode === "password" && (existingEmail || existingUsername)) {
      const [candidate] =
        await tx`select m.team_id from name_card_auth."user" u join name_card.memberships m on m.user_id=u.id
        where ((${existingEmail}<>'' and u.email=${existingEmail}) or (${existingUsername}<>'' and u.username=${existingUsername}))
        and m.role='admin' and m.status='active'`;
      if (!candidate)
        throw new Error(
          "The explicitly specified active administrator was not found",
        );
      await tx`select id from name_card.teams where id=${candidate.team_id} for update`;
      const [admin] =
        await tx`select u.id,m.team_id,u.username from name_card_auth."user" u join name_card.memberships m on m.user_id=u.id
        where ((${existingEmail}<>'' and u.email=${existingEmail}) or (${existingUsername}<>'' and u.username=${existingUsername}))
        and m.role='admin' and m.status='active' for update of u,m`;
      if (!admin)
        throw new Error(
          "The explicitly specified active administrator was not found",
        );
      if (admin.username && admin.username !== username)
        throw new Error("Existing username cannot be changed");
      const [credential] =
        await tx`select id,password from name_card_auth.account where "providerId"='credential' and "userId"=${admin.id}`;
      if (
        credential?.password &&
        process.env.BOOTSTRAP_RESET_PASSWORD !== "YES"
      )
        throw new Error(
          "Password already exists. Explicit BOOTSTRAP_RESET_PASSWORD=YES is required for operator recovery",
        );
      await tx`update name_card_auth."user" set username=${username},"updatedAt"=now() where id=${admin.id}`;
      await tx`insert into name_card_auth.account(id,"accountId","providerId","userId",password) values(${randomUUID()},${admin.id},'credential',${admin.id},${passwordHash})
        on conflict("providerId","accountId") do update set password=excluded.password,"updatedAt"=now()`;
      await tx`update name_card.memberships set password_change_required=false where user_id=${admin.id}`;
      await tx`delete from name_card_auth.session where "userId"=${admin.id}`;
      await tx`insert into name_card.audit_events(team_id,actor_id,action,target_id) values(${admin.team_id},${admin.id},'member.operator-password',${admin.id})`;
      console.log(
        "Password login configured for the explicitly selected existing administrator. All their sessions were revoked.",
      );
      console.log(`Team ID: ${admin.team_id}`);
      return;
    }
    const [team] = await tx`select id from name_card.teams limit 1`;
    if (team)
      throw new Error(
        "A team already exists. Invite additional admins through member settings.",
      );
    const teamId = randomUUID();
    await tx`insert into name_card.teams(id,name) values(${teamId},${process.env.TEAM_NAME || "共有名刺チーム"})`;
    if (mode === "password") {
      const id = randomUUID();
      const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || username;
      if (name.length > 80)
        throw new Error("BOOTSTRAP_ADMIN_NAME must be at most 80 characters");
      await tx`insert into name_card_auth."user"(id,name,email,username) values(${id},${name},${id + "@users.invalid"},${username})`;
      await tx`insert into name_card_auth.account(id,"accountId","providerId","userId",password) values(${randomUUID()},${id},'credential',${id},${passwordHash})`;
      await tx`insert into name_card.memberships(team_id,user_id,role) values(${teamId},${id},'admin')`;
      await tx`insert into name_card.audit_events(team_id,actor_id,action,target_id) values(${teamId},${id},'member.bootstrap',${id})`;
      console.log(
        "Team and password administrator created. Sign in with the configured username. Password is not printed.",
      );
      console.log(`Team ID: ${teamId}`);
      return;
    }
    await tx`insert into name_card.invitations(id,team_id,email,role,expires_at) values(${randomUUID()},${teamId},${email},'admin',now()+interval '7 days')`;
    console.log(
      "Team created. The specified administrator can sign in with Google within 7 days.",
    );
  });
} finally {
  await sql.end();
}

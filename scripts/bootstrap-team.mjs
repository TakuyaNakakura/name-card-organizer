import { randomUUID } from "node:crypto";
import postgres from "postgres";

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw new Error("Set BOOTSTRAP_ADMIN_EMAIL explicitly");
if (!process.env.DATABASE_MIGRATION_URL)
  throw new Error("DATABASE_MIGRATION_URL is required");
const sql = postgres(process.env.DATABASE_MIGRATION_URL, {
  max: 1,
  prepare: false,
});
try {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(497300291)`;
    const [team] = await tx`select id from name_card.teams limit 1`;
    if (team)
      throw new Error(
        "A team already exists. Invite additional admins through member settings.",
      );
    const teamId = randomUUID();
    await tx`insert into name_card.teams(id,name) values(${teamId},${process.env.TEAM_NAME || "共有名刺チーム"})`;
    await tx`insert into name_card.invitations(id,team_id,email,role,expires_at) values(${randomUUID()},${teamId},${email},'admin',now()+interval '7 days')`;
    console.log(
      "Team created. The specified administrator can sign in with Google within 7 days.",
    );
  });
} finally {
  await sql.end();
}

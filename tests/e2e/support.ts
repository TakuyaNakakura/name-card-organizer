import { randomUUID, createHmac } from "node:crypto";
import postgres from "postgres";
import type { BrowserContext } from "@playwright/test";
export const testUrl =
  process.env.TEST_DATABASE_URL ||
  "postgres://postgres:local-test-only@127.0.0.1:55434/name_card_test";
export const testSecret =
  "local-playwright-only-secret-not-for-deployment-2026";
const parsed = new URL(testUrl);
if (
  !["localhost", "127.0.0.1", "postgres"].includes(parsed.hostname) ||
  parsed.pathname !== "/name_card_test"
)
  throw new Error(
    "E2E tests require an isolated local name_card_test database",
  );
export async function provisionSession(
  context: BrowserContext,
  teamId?: string,
  role: "admin" | "member" = "admin",
) {
  const sql = postgres(testUrl, { max: 1, prepare: false }),
    id = randomUUID(),
    team = teamId || randomUUID(),
    token = randomUUID();
  try {
    if (!teamId)
      await sql`insert into name_card.teams(id,name) values(${team},'検証チーム')`;
    await sql`insert into name_card_auth."user"(id,name,email,"emailVerified") values(${id},${role === "admin" ? "管理者" : "メンバー"},${id + "@example.test"},true)`;
    await sql`insert into name_card.memberships(team_id,user_id,role) values(${team},${id},${role})`;
    await sql`insert into name_card_auth.session(id,token,"userId","expiresAt") values(${randomUUID()},${token},${id},now()+interval '1 day')`;
    const signature = createHmac("sha256", testSecret)
      .update(token)
      .digest("base64");
    await context.addCookies([
      {
        name: "nco-team.session_token",
        value: encodeURIComponent(`${token}.${signature}`),
        url: "http://127.0.0.1:3100",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    return { userId: id, teamId: team };
  } finally {
    await sql.end();
  }
}

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import sharp from "sharp";
import {
  acceptInvitation,
  authorizedAsset,
  changeMember,
  confirmDraft,
  consumeScanQuota,
  editCard,
  editDraft,
  getCard,
  getDraft,
  invited,
  listTeamCards,
  reserveDraft,
  sessionForUser,
  setCardDeleted,
  teamSql,
} from "@/lib/team-db";
import { createTeamScan } from "@/lib/team-scan-service";
import { runMaintenance } from "@/lib/maintenance";
import type { TeamSession } from "@/lib/team-types";

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "TEST_DATABASE_URL required. Use docker-compose.test.yml; never test against a live database.",
  );
const parsed = new URL(url);
if (
  !["localhost", "127.0.0.1", "postgres"].includes(parsed.hostname) ||
  parsed.pathname !== "/name_card_test"
)
  throw new Error(
    "Integration tests require an isolated local name_card_test database",
  );
process.env.DATABASE_URL = url;
process.env.OCR_PROVIDER = "mock";
process.env.STORAGE_DRIVER = "local";
process.env.LOCAL_UPLOAD_DIR = "/tmp/name-card-team-integration";
const sql = postgres(url, { max: 2, prepare: false }),
  teamId = randomUUID(),
  otherTeamId = randomUUID();
const admin: TeamSession = {
  teamId,
  userId: randomUUID(),
  name: "管理者",
  email: "admin@example.test",
  teamName: "検証チーム",
  role: "admin",
};
const owner: TeamSession = {
  ...admin,
  userId: randomUUID(),
  name: "登録者",
  email: "owner@example.test",
  role: "member",
};
const peer: TeamSession = {
  ...admin,
  userId: randomUUID(),
  name: "閲覧者",
  email: "peer@example.test",
  role: "member",
};
const outsider: TeamSession = {
  ...admin,
  teamId: otherTeamId,
  userId: randomUUID(),
  email: "outsider@example.test",
};
let image: Buffer;
beforeAll(async () => {
  // The sentinel has unrelated NOT NULL columns; the migration must leave it untouched.
  await sql`create table if not exists public.cards (id text primary key,issuer text not null,name text not null)`;
  await sql`insert into public.cards(id,issuer,name) values('other-service','sentinel','unchanged') on conflict(id) do nothing`;
  execFileSync(process.execPath, ["scripts/migrate.mjs"], {
    env: { ...process.env, DATABASE_MIGRATION_URL: url },
    stdio: "pipe",
  });
  await sql`insert into name_card.teams(id,name) values(${teamId},'検証チーム'),(${otherTeamId},'別チーム')`;
  for (const s of [admin, owner, peer, outsider]) {
    await sql`insert into name_card_auth."user"(id,name,email,"emailVerified") values(${s.userId},${s.name},${randomUUID() + "@example.test"},true)`;
    await sql`insert into name_card.memberships(team_id,user_id,role) values(${s.teamId},${s.userId},${s.role})`;
  }
  image = await sharp({
    create: { width: 400, height: 250, channels: 3, background: "#fff" },
  })
    .jpeg()
    .toBuffer();
});
afterAll(async () => {
  await sql.end();
  await teamSql().end();
});
const scan = (s = owner, id = randomUUID()) =>
  createTeamScan(s, id, image, image);

describe("team database and image security", () => {
  it("copies reviewed legacy data without modifying source records or images", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "name-card-import-")),
      id = randomUUID(),
      scanId = randomUUID();
    try {
      const key = `drafts/${scanId}/original.jpg`;
      await mkdir(path.dirname(path.join(root, key)), { recursive: true });
      await writeFile(path.join(root, key), image);
      const row = {
        id,
        fullName: "旧名刺",
        organization: "旧組織",
        jobTitle: "担当",
        email: "legacy@example.test",
        originalImageUrl: `/api/assets/${key}`,
        correctedImageUrl: `/api/assets/${key}`,
        rawOcrText: "旧OCR",
        extractionConfidence: 0.8,
        status: "confirmed",
        createdAt: "2026-03-15T12:00:00.000Z",
        updatedAt: "2026-03-16T12:00:00.000Z",
      };
      const manifest = path.join(root, "manifest.json");
      await writeFile(manifest, JSON.stringify([row]));
      const [u] =
        await sql`select email from name_card_auth."user" where id=${admin.userId}`;
      const env = {
        ...process.env,
        DATABASE_MIGRATION_URL: url,
        LEGACY_IMPORT_FILE: manifest,
        IMPORT_TEAM_ID: teamId,
        IMPORT_OWNER_EMAIL: u.email,
        LOCAL_UPLOAD_DIR: root,
        STORAGE_DRIVER: "local",
        APPLY_LEGACY_IMPORT: "",
      };
      execFileSync(process.execPath, ["scripts/import-legacy-cards.mjs"], {
        env,
        stdio: "pipe",
      });
      expect(
        await sql`select 1 from name_card.cards where id=${id}`,
      ).toHaveLength(0);
      for (let i = 0; i < 2; i++)
        execFileSync(process.execPath, ["scripts/import-legacy-cards.mjs"], {
          env: { ...env, APPLY_LEGACY_IMPORT: "YES" },
          stdio: "pipe",
        });
      const card = await getCard(peer, id);
      expect(card.createdBy).toBeNull();
      expect(card.canEdit).toBe(false);
      expect(card.createdAt).toBe(row.createdAt);
      expect(card.fullName).toBe(row.fullName);
      const assets =
        await sql`select storage_key from name_card.assets where card_id=${id}`;
      expect(assets).toHaveLength(2);
      for (const a of assets)
        expect(await readFile(path.join(root, a.storage_key))).toEqual(image);
      expect(await readFile(path.join(root, key))).toEqual(image);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("runtime role can access only the new schemas and cannot execute DDL", async () => {
    const role = "nco_test_" + randomUUID().replaceAll("-", "");
    await sql`create role ${sql(role)} login password 'local-runtime-test-only'`;
    const grants = await readFile("db/runtime-grants.sql", "utf8");
    await sql.unsafe(grants.replaceAll("name_card_app", role));
    const connection = new URL(url!);
    connection.username = role;
    connection.password = "local-runtime-test-only";
    const runtime = postgres(connection.toString(), { max: 1, prepare: false });
    try {
      expect(
        (await runtime`select count(*)::int total from name_card.teams`)[0]
          .total,
      ).toBeGreaterThan(0);
      await expect(
        runtime`create table name_card.forbidden(id int)`,
      ).rejects.toMatchObject({ code: "42501" });
      await expect(runtime`select * from public.cards`).rejects.toMatchObject({
        code: "42501",
      });
      await expect(
        runtime`update name_card.migrations set checksum='bad'`,
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await runtime.end();
      await sql`drop owned by ${sql(role)}`;
      await sql`drop role ${sql(role)}`;
    }
  });
  it("uses explicit versioned migrations and preserves other services", async () => {
    const [r] = await sql`select * from public.cards where id='other-service'`;
    expect(r.issuer).toBe("sentinel");
    expect(r.name).toBe("unchanged");
    const columns =
      await sql`select column_name from information_schema.columns where table_schema='public' and table_name='cards'`;
    expect(columns.map((r) => r.column_name).sort()).toEqual([
      "id",
      "issuer",
      "name",
    ]);
    execFileSync(process.execPath, ["scripts/migrate.mjs"], {
      env: { ...process.env, DATABASE_MIGRATION_URL: url },
      stdio: "pipe",
    });
  });
  it("only admits an explicitly invited email; no first-login administrator", async () => {
    const id = randomUUID(),
      email = id + "@example.test";
    expect(await invited(email)).toBe(false);
    expect(await acceptInvitation(id, email)).toBe(false);
    await sql`insert into name_card_auth."user"(id,name,email,"emailVerified") values(${id},'招待者',${email},true)`;
    await sql`insert into name_card.invitations(id,team_id,email,role,expires_at) values(${randomUUID()},${teamId},${email},'member',now()+interval '1 day')`;
    expect(await acceptInvitation(id, email)).toBe(true);
    expect((await sessionForUser(id))?.role).toBe("member");
    expect(await invited(email)).toBe(false);
  });
  it("keeps drafts and images private, including from administrators", async () => {
    const d = await scan();
    expect(d.status).toBe("ready");
    expect(Array.isArray(d.warnings)).toBe(true);
    await expect(getDraft(peer, d.id)).rejects.toMatchObject({ status: 404 });
    await expect(getDraft(admin, d.id)).rejects.toMatchObject({ status: 404 });
    const assetId = d.correctedImageUrl.split("/").at(-1)!;
    await expect(authorizedAsset(peer, assetId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(authorizedAsset(admin, assetId)).rejects.toMatchObject({
      status: 404,
    });
    expect((await authorizedAsset(owner, assetId)).draft_id).toBe(d.id);
  });
  it("is idempotent for repeated uploads and simultaneous confirmation", async () => {
    const clientId = randomUUID(),
      d = await scan(owner, clientId);
    expect((await scan(owner, clientId)).id).toBe(d.id);
    const [a, b] = await Promise.all([
      confirmDraft(owner, d.id, d.version),
      confirmDraft(owner, d.id, d.version),
    ]);
    expect(a.id).toBe(b.id);
    expect((await getCard(peer, a.id)).fullName).toBe(a.fullName);
    await expect(getCard(outsider, a.id)).rejects.toMatchObject({
      status: 404,
    });
    const assetId = a.correctedImageUrl.split("/").at(-1)!;
    expect((await authorizedAsset(peer, assetId)).card_id).toBe(a.id);
  });
  it("allows email-less records, rejects stale edits and non-owner changes", async () => {
    let d = await scan();
    const fields = {
      fullName: "山田 花子",
      organization: "検証組織",
      jobTitle: "担当",
      email: "",
    };
    d = await editDraft(owner, d.id, d.version, fields);
    await expect(
      editDraft(owner, d.id, d.version - 1, fields),
    ).rejects.toMatchObject({ status: 409 });
    const card = await confirmDraft(owner, d.id, d.version);
    expect(card.email).toBe("");
    await expect(
      editCard(peer, card.id, card.version, fields),
    ).rejects.toMatchObject({ status: 403 });
    const updated = await editCard(admin, card.id, card.version, {
      ...fields,
      jobTitle: "責任者",
    });
    expect(updated.version).toBe(card.version + 1);
    await expect(
      editCard(owner, card.id, card.version, fields),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("soft-deletes, denies image access in trash and restores with permissions", async () => {
    const d = await scan(),
      card = await confirmDraft(owner, d.id, d.version),
      assetId = card.correctedImageUrl.split("/").at(-1)!;
    await expect(
      setCardDeleted(peer, card.id, card.version),
    ).rejects.toMatchObject({ status: 403 });
    await setCardDeleted(owner, card.id, card.version);
    await expect(getCard(owner, card.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(authorizedAsset(owner, assetId)).rejects.toMatchObject({
      status: 404,
    });
    const trash = await listTeamCards(owner, { trash: true });
    const deleted = trash.items.find((c) => c.id === card.id)!;
    expect(deleted).toBeTruthy();
    await setCardDeleted(admin, card.id, deleted.version, true);
    expect((await getCard(peer, card.id)).deletedAt).toBeNull();
  });
  it("serializes scans per person and uses atomic shared quotas", async () => {
    const person = { ...peer, userId: owner.userId };
    const pending = await reserveDraft(person, randomUUID());
    await expect(reserveDraft(person, randomUUID())).rejects.toMatchObject({
      code: "SCAN_BUSY",
    });
    await sql`update name_card.drafts set status='failed' where id=${pending.id}`;
    const scope = "user:" + peer.userId;
    await sql`insert into name_card.usage_counters(scope,window_start,count) values(${scope},date_trunc('hour',now()),29) on conflict(scope,window_start) do update set count=29`;
    const settled = await Promise.allSettled([
      consumeScanQuota(peer),
      consumeScanQuota(peer),
    ]);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("revokes suspended members and protects the last administrator", async () => {
    await expect(
      changeMember(admin, admin.userId, "member", "active"),
    ).rejects.toMatchObject({ code: "LAST_ADMIN" });
    await sql`insert into name_card_auth.session(id,token,"userId","expiresAt") values(${randomUUID()},${randomUUID()},${peer.userId},now()+interval '1 day')`;
    await changeMember(admin, peer.userId, "member", "suspended");
    expect(await sessionForUser(peer.userId)).toBeNull();
    const sessions =
      await sql`select 1 from name_card_auth.session where "userId"=${peer.userId}`;
    expect(sessions).toHaveLength(0);
    await changeMember(admin, peer.userId, "member", "active");
  });
  it("never deletes confirmed images when their original draft expires", async () => {
    const d = await scan(),
      card = await confirmDraft(owner, d.id, d.version);
    await sql`update name_card.drafts set expires_at=now()-interval '1 day' where id=${d.id}`;
    await runMaintenance();
    expect((await getCard(owner, card.id)).correctedImageUrl).toBeTruthy();
    expect(
      (await authorizedAsset(peer, card.correctedImageUrl.split("/").at(-1)!))
        .card_id,
    ).toBe(card.id);
    const events =
      await sql`select * from name_card.audit_events where team_id=${teamId}`;
    expect(JSON.stringify(events)).not.toContain("Jane Doe");
  });
});

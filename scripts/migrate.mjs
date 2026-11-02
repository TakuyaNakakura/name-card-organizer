import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const url = process.env.DATABASE_MIGRATION_URL;
if (!url)
  throw new Error(
    "DATABASE_MIGRATION_URL is required. No automatic fallback to the runtime database.",
  );
const sql = postgres(url, { max: 1, prepare: false });
try {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(497300291)`;
    await tx`create schema if not exists name_card`;
    await tx`create table if not exists name_card.migrations (version text primary key, checksum text not null, applied_at timestamptz not null default now())`;
    const version = "002_team";
    const contents = await readFile(
      new URL("../db/migrations/002_team.sql", import.meta.url),
      "utf8",
    );
    const checksum = createHash("sha256").update(contents).digest("hex");
    const [applied] =
      await tx`select checksum from name_card.migrations where version=${version}`;
    if (applied && applied.checksum !== checksum)
      throw new Error("Applied migration checksum differs");
    if (!applied) {
      await tx.unsafe(contents);
      await tx`insert into name_card.migrations(version,checksum) values(${version},${checksum})`;
    }
    console.log(
      applied
        ? "Schema is up to date"
        : "Applied 002_team (legacy public.cards untouched)",
    );
  });
} finally {
  await sql.end();
}

import postgres, { type Sql } from "postgres";

import type { CardRecord } from "@/lib/types";
import { getOptionalEnv, getRequiredEnv } from "@/lib/env";

interface CardRow {
  id: string;
  full_name: string | null;
  email: string;
  original_image_url: string;
  corrected_image_url: string;
  raw_ocr_text: string;
  extraction_confidence: number;
  status: "confirmed";
  created_at: Date | string;
  updated_at: Date | string;
}

let sqlInstance: Sql | null = null;
let schemaPromise: Promise<void> | null = null;

function isVercelRuntime() {
  return process.env.VERCEL === "1";
}

function getDatabaseUrl() {
  return getRequiredEnv("DATABASE_URL");
}

export function isPlaceholderDatabaseUrl(value: string) {
  return /:\/\/USER:PASSWORD@HOST:PORT\/DB/i.test(value);
}

export function toIsoTimestamp(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid timestamp value: ${String(value)}`);
  }

  return parsed.toISOString();
}

function sanitizeDatabaseErrorDetail(value: string) {
  return value
    .replace(
      /\bpostgres(ql)?:\/\/([^:@/\s]+)(?::[^@/\s]*)?@/gi,
      "postgres://***:***@"
    )
    .replace(/(password=)[^&\s]+/gi, "$1***")
    .replace(/(api[_-]?key=)[^&\s]+/gi, "$1***");
}

export function getDatabaseErrorMessage(error: unknown) {
  const databaseUrl = getOptionalEnv("DATABASE_URL");
  if (databaseUrl && isPlaceholderDatabaseUrl(databaseUrl)) {
    return "DATABASE_URL がサンプル値のままです。Vercel の環境変数を実際の接続先に置き換えてください。";
  }

  if (!(error instanceof Error)) {
    return "データベース処理に失敗しました。";
  }

  const message = error.message;
  if (
    /connect|connection|ECONN|ENOTFOUND|timeout|SSL|TLS|certificate|database .* does not exist|password authentication failed/i.test(
      message
    )
  ) {
    return "データベースへ接続できません。Vercel の DATABASE_URL を確認してください。";
  }

  return "データベース処理に失敗しました。";
}

export function getDatabaseErrorDetail(error: unknown) {
  if (!(error instanceof Error)) {
    return null;
  }

  return sanitizeDatabaseErrorDetail(error.message);
}

export async function checkDatabaseConnection() {
  const databaseUrl = getDatabaseUrl();
  if (isPlaceholderDatabaseUrl(databaseUrl)) {
    return {
      ok: false as const,
      message:
        "DATABASE_URL がサンプル値のままです。Vercel の環境変数を実際の接続先に置き換えてください。",
      detail: sanitizeDatabaseErrorDetail(databaseUrl)
    };
  }

  try {
    const sql = getSql();
    const rows = await sql<
      { current_database: string; current_user: string; current_time: Date | string }[]
    >`
      select
        current_database() as current_database,
        current_user as current_user,
        now() as current_time
    `;
    const row = rows[0];

    return {
      ok: true as const,
      database: row.current_database,
      user: row.current_user,
      currentTime: toIsoTimestamp(row.current_time)
    };
  } catch (error) {
    return {
      ok: false as const,
      message: getDatabaseErrorMessage(error),
      detail: getDatabaseErrorDetail(error)
    };
  }
}

function mapCardRow(row: CardRow): CardRecord {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    originalImageUrl: row.original_image_url,
    correctedImageUrl: row.corrected_image_url,
    rawOcrText: row.raw_ocr_text,
    extractionConfidence: row.extraction_confidence,
    status: row.status,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

function getSql(): Sql {
  if (!sqlInstance) {
    const databaseUrl = getDatabaseUrl();
    if (isPlaceholderDatabaseUrl(databaseUrl)) {
      throw new Error(
        "DATABASE_URL is still using the example placeholder USER:PASSWORD@HOST:PORT/DB"
      );
    }

    sqlInstance = postgres(databaseUrl, {
      max: isVercelRuntime() ? 1 : 5,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false
    });
  }

  return sqlInstance;
}

async function ensureSchema() {
  if (!schemaPromise) {
    const sql = getSql();
    schemaPromise = (async () => {
      await sql`
        create table if not exists cards (
          id uuid primary key,
          full_name text,
          email text not null,
          original_image_url text not null,
          corrected_image_url text not null,
          raw_ocr_text text not null,
          extraction_confidence real not null,
          status text not null check (status in ('confirmed')),
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `;
      await sql`
        create index if not exists idx_cards_created_at
        on cards (created_at desc)
      `;
      await sql`
        create index if not exists idx_cards_search
        on cards (lower(coalesce(full_name, '')), lower(email))
      `;
    })();
  }

  await schemaPromise;
}

export interface CreateCardInput {
  id: string;
  fullName: string | null;
  email: string;
  originalImageUrl: string;
  correctedImageUrl: string;
  rawOcrText: string;
  extractionConfidence: number;
}

export async function insertCard(input: CreateCardInput): Promise<CardRecord> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<CardRow[]>`
    insert into cards (
      id,
      full_name,
      email,
      original_image_url,
      corrected_image_url,
      raw_ocr_text,
      extraction_confidence,
      status
    )
    values (
      ${input.id},
      ${input.fullName},
      ${input.email},
      ${input.originalImageUrl},
      ${input.correctedImageUrl},
      ${input.rawOcrText},
      ${input.extractionConfidence},
      'confirmed'
    )
    returning
      id,
      full_name,
      email,
      original_image_url,
      corrected_image_url,
      raw_ocr_text,
      extraction_confidence,
      status,
      created_at,
      updated_at
  `;

  return mapCardRow(rows[0]);
}

export async function listCards(searchTerm?: string): Promise<CardRecord[]> {
  await ensureSchema();
  const sql = getSql();
  const query = searchTerm?.trim().toLowerCase();
  const rows = query
    ? await sql<CardRow[]>`
        select
          id,
          full_name,
          email,
          original_image_url,
          corrected_image_url,
          raw_ocr_text,
          extraction_confidence,
          status,
          created_at,
          updated_at
        from cards
        where
          lower(coalesce(full_name, '')) like ${`%${query}%`}
          or lower(email) like ${`%${query}%`}
        order by created_at desc
      `
    : await sql<CardRow[]>`
        select
          id,
          full_name,
          email,
          original_image_url,
          corrected_image_url,
          raw_ocr_text,
          extraction_confidence,
          status,
          created_at,
          updated_at
        from cards
        order by created_at desc
      `;

  return rows.map(mapCardRow);
}

export async function deleteCardById(cardId: string): Promise<CardRecord | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<CardRow[]>`
    delete from cards
    where id = ${cardId}
    returning
      id,
      full_name,
      email,
      original_image_url,
      corrected_image_url,
      raw_ocr_text,
      extraction_confidence,
      status,
      created_at,
      updated_at
  `;

  return rows[0] ? mapCardRow(rows[0]) : null;
}

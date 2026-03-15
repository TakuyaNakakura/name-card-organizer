import postgres, { type Sql } from "postgres";

import type { CardRecord } from "@/lib/types";
import { getRequiredEnv } from "@/lib/env";

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

export function toIsoTimestamp(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid timestamp value: ${String(value)}`);
  }

  return parsed.toISOString();
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
    sqlInstance = postgres(getRequiredEnv("DATABASE_URL"), {
      max: 5,
      idle_timeout: 20
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

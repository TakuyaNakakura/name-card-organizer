import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { insertCard, listCards } from "@/lib/db";
import { requireSession } from "@/lib/http";
import { verifyDraftToken } from "@/lib/session";

export const runtime = "nodejs";

interface CreateCardBody {
  draftToken?: string;
  fullName?: string | null;
  email?: string;
}

export async function GET(request: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const search = url.searchParams.get("q") ?? undefined;
  const cards = await listCards(search);
  return NextResponse.json(cards);
}

export async function POST(request: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as CreateCardBody;
  if (!body.draftToken || !body.email?.trim()) {
    return NextResponse.json(
      { error: "draftToken and email are required" },
      { status: 400 }
    );
  }

  const draft = await verifyDraftToken(body.draftToken);
  const record = await insertCard({
    id: randomUUID(),
    fullName: body.fullName?.trim() || null,
    email: body.email.trim(),
    originalImageUrl: draft.originalImageUrl,
    correctedImageUrl: draft.correctedImageUrl,
    rawOcrText: draft.rawOcrText,
    extractionConfidence: draft.confidence
  });

  return NextResponse.json(record, { status: 201 });
}

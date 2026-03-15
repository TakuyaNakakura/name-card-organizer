import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getDatabaseErrorMessage, insertCard, listCards } from "@/lib/db";
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
  try {
    const cards = await listCards(search);
    return NextResponse.json(cards);
  } catch (error) {
    console.error("Failed to list cards", error);
    return NextResponse.json(
      { error: getDatabaseErrorMessage(error) },
      { status: 503 }
    );
  }
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

  try {
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
  } catch (error) {
    console.error("Failed to save card", error);

    if (error instanceof Error && /JWT|token|expir/i.test(error.message)) {
      return NextResponse.json(
        { error: "下書きの有効期限が切れました。もう一度スキャンしてください。" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: getDatabaseErrorMessage(error) },
      { status: 503 }
    );
  }
}

import { NextResponse } from "next/server";

import { checkDatabaseConnection } from "@/lib/db";
import { requireSession } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await checkDatabaseConnection();
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}

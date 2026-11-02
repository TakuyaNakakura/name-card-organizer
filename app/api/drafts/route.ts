import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { requireSession } from "@/lib/http";
import { listDrafts } from "@/lib/team-db";
export async function GET() {
  try {
    return NextResponse.json({
      items: await listDrafts(await requireSession()),
    });
  } catch (error) {
    return apiError(error);
  }
}

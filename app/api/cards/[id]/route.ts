import { NextResponse } from "next/server";

import { deleteCardAndAssets } from "@/lib/card-service";
import { getDatabaseErrorDetail, getDatabaseErrorMessage } from "@/lib/db";
import { requireSession } from "@/lib/http";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const deletedCard = await deleteCardAndAssets(id);
    if (!deletedCard) {
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    }

    return NextResponse.json({ id: deletedCard.id });
  } catch (error) {
    console.error(`Failed to delete card: ${id}`, error);
    return NextResponse.json(
      {
        error: getDatabaseErrorMessage(error),
        detail: getDatabaseErrorDetail(error)
      },
      { status: 503 }
    );
  }
}

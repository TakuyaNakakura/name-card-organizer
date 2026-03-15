import { describe, expect, it } from "vitest";

import { cardsToCsv } from "@/lib/csv";
import type { CardRecord } from "@/lib/types";

const sampleCard: CardRecord = {
  id: "1",
  fullName: "渡辺 亮",
  email: "ryo@example.com",
  originalImageUrl: "/api/assets/drafts/1/original.jpg",
  correctedImageUrl: "/api/assets/drafts/1/corrected.jpg",
  rawOcrText: "渡辺 亮\nryo@example.com",
  extractionConfidence: 0.9,
  status: "confirmed",
  createdAt: "2026-03-15T12:00:00.000Z",
  updatedAt: "2026-03-15T12:00:00.000Z"
};

describe("cardsToCsv", () => {
  it("adds UTF-8 BOM and CRLF for Excel-friendly output", () => {
    const csv = cardsToCsv([sampleCard], {
      excelFriendly: true
    });

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).toContain("渡辺 亮");
  });
});

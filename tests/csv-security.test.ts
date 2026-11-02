import { expect, it } from "vitest";
import { cardsToCsv } from "@/lib/csv";
it("protects spreadsheet formulas while preserving Japanese and Excel encoding", () => {
  const csv = cardsToCsv(
    [
      {
        id: "test",
        fullName: '=HYPERLINK("https://attacker.invalid")',
        organization: "日本語",
        jobTitle: " +CMD",
        email: "",
        correctedImageUrl: "",
        createdAt: "2026-11-02",
      },
    ],
    { excelFriendly: true },
  );
  expect(csv.startsWith("\uFEFF")).toBe(true);
  expect(csv).toContain("日本語");
  expect(csv).toContain("'=HYPERLINK");
  expect(csv).toContain("' +CMD");
  expect(csv).toContain("\r\n");
});

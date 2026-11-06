import { describe, expect, it } from "vitest";
import { normalizeOcrLine } from "@/lib/ocr-text";

describe("OCR suggestion normalization", () => {
  it.each([
    [" 株 式 会 社　サ ン プ ル ", "株式会社サンプル"],
    ["山 田　太 郎", "山田太郎"],
    ["FE設計営 業 課 課 長", "FE設計営業課課長"],
    ["\ufeff営\u200b業\u2060課", "営業課"],
    [" John  Smith ", "John Smith"],
    [" Sample Co., Ltd. ", "Sample Co., Ltd."],
    ["株式会社 Sample", "株式会社 Sample"],
    ["Jean-Luc O'Neil", "Jean-Luc O'Neil"],
    ["jane+sales@example.test", "jane+sales@example.test"],
  ])("normalizes %j without changing meaningful Latin separators", (input, expected) => {
    expect(normalizeOcrLine(input)).toBe(expected);
    expect(normalizeOcrLine(normalizeOcrLine(input))).toBe(expected);
  });
});

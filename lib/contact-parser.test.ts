import { describe, expect, it } from "vitest";

import { extractContactInfo } from "@/lib/contact-parser";
import type { OcrResult } from "@/lib/types";

describe("extractContactInfo", () => {
  it("cleans Japanese suggestions before scoring and leaves the OCR source unchanged", () => {
    const texts = ["株 式 会 社 サ ン プ ル", "山 田 太 郎", "営 業 課 課 長"];
    const ocr: OcrResult = {
      rawText: texts.join("\n") + "\ntaro\u200b@example.test",
      overallConfidence: 0.95,
      blocks: texts.map((text, index) => ({
        text,
        confidence: 0.95,
        bounds: { x: 10, y: index * 60, width: 250, height: index === 1 ? 44 : 28 },
      })),
    };
    const before = structuredClone(ocr);
    expect(extractContactInfo(ocr)).toMatchObject({
      fullName: "山田太郎",
      organization: "株式会社サンプル",
      jobTitle: "営業課課長",
      email: "taro@example.test",
    });
    expect(ocr).toEqual(before);
  });
  it("extracts the strongest name, organization, title, and primary email", () => {
    const ocr: OcrResult = {
      rawText: "ACME Inc.\nPlatform Division\nJane Doe\nHead of Sales\njane@example.com",
      overallConfidence: 0.94,
      blocks: [
        {
          text: "ACME Inc.",
          confidence: 0.95,
          bounds: { x: 40, y: 18, width: 220, height: 28 }
        },
        {
          text: "Platform Division",
          confidence: 0.94,
          bounds: { x: 40, y: 52, width: 240, height: 28 }
        },
        {
          text: "Jane Doe",
          confidence: 0.97,
          bounds: { x: 40, y: 88, width: 220, height: 44 }
        },
        {
          text: "Head of Sales",
          confidence: 0.9,
          bounds: { x: 40, y: 138, width: 260, height: 28 }
        },
        {
          text: "jane@example.com",
          confidence: 0.99,
          bounds: { x: 40, y: 176, width: 260, height: 24 }
        }
      ]
    };

    expect(extractContactInfo(ocr)).toMatchObject({
      fullName: "Jane Doe",
      organization: "ACME Inc. Platform Division",
      jobTitle: "Head of Sales",
      email: "jane@example.com"
    });
  });

  it("emits a warning when multiple email addresses are present", () => {
    const ocr: OcrResult = {
      rawText: "Jane Doe\njane@example.com\ncontact@example.com",
      overallConfidence: 0.9,
      blocks: [
        {
          text: "Jane Doe",
          confidence: 0.95,
          bounds: { x: 20, y: 24, width: 200, height: 40 }
        }
      ]
    };

    const result = extractContactInfo(ocr);
    expect(result.email).toBe("jane@example.com");
    expect(result.warnings).toContain("複数のメールアドレス候補が見つかりました");
  });

  it("falls back to manual name entry when no reliable name exists", () => {
    const ocr: OcrResult = {
      rawText: "ACME Inc.\nPlatform Division\ninfo@example.com",
      overallConfidence: 0.88,
      blocks: [
        {
          text: "ACME Inc.",
          confidence: 0.91,
          bounds: { x: 20, y: 18, width: 240, height: 28 }
        },
        {
          text: "Platform Division",
          confidence: 0.9,
          bounds: { x: 20, y: 58, width: 260, height: 26 }
        }
      ]
    };

    const result = extractContactInfo(ocr);
    expect(result.fullName).toBeNull();
    expect(result.organization).toBe("ACME Inc. Platform Division");
    expect(result.jobTitle).toBeNull();
    expect(result.warnings).toContain("名前候補の確度が低いため手入力が必要です");
  });
});

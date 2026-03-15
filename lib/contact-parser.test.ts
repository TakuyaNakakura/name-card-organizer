import { describe, expect, it } from "vitest";

import { extractContactInfo } from "@/lib/contact-parser";
import type { OcrResult } from "@/lib/types";

describe("extractContactInfo", () => {
  it("extracts the strongest name candidate and primary email", () => {
    const ocr: OcrResult = {
      rawText: "Jane Doe\nHead of Sales\njane@example.com",
      overallConfidence: 0.94,
      blocks: [
        {
          text: "Jane Doe",
          confidence: 0.97,
          bounds: { x: 40, y: 30, width: 220, height: 44 }
        },
        {
          text: "Head of Sales",
          confidence: 0.9,
          bounds: { x: 40, y: 90, width: 260, height: 28 }
        },
        {
          text: "jane@example.com",
          confidence: 0.99,
          bounds: { x: 40, y: 132, width: 260, height: 24 }
        }
      ]
    };

    expect(extractContactInfo(ocr)).toMatchObject({
      fullName: "Jane Doe",
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
    expect(result.warnings).toContain("名前候補の確度が低いため手入力が必要です");
  });
});

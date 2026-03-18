import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  putObject: vi.fn(),
  recognize: vi.fn(),
  signDraftToken: vi.fn()
}));

vi.mock("@/lib/storage", () => ({
  buildAssetUrl: (key: string) => `/api/assets/${key}`,
  getStorage: () => ({
    putObject: mocks.putObject
  })
}));

vi.mock("@/lib/ocr", () => ({
  getOcrClient: () => ({
    recognize: mocks.recognize
  })
}));

vi.mock("@/lib/session", () => ({
  signDraftToken: mocks.signDraftToken
}));

import { scanBusinessCard } from "@/lib/scan-service";

describe("scanBusinessCard", () => {
  beforeEach(() => {
    mocks.putObject.mockReset();
    mocks.recognize.mockReset();
    mocks.signDraftToken.mockReset();
    mocks.putObject.mockResolvedValue(undefined);
    mocks.signDraftToken.mockResolvedValue("draft-token");
  });

  it("stores images and returns a draft with extracted contact fields", async () => {
    mocks.recognize.mockResolvedValue({
      rawText: "ACME Inc.\nPlatform Division\nHead of Sales\nJane Doe\njane@example.com",
      overallConfidence: 0.91,
      blocks: [
        {
          text: "ACME Inc.",
          confidence: 0.95,
          bounds: { x: 30, y: 12, width: 220, height: 28 }
        },
        {
          text: "Platform Division",
          confidence: 0.94,
          bounds: { x: 30, y: 44, width: 220, height: 26 }
        },
        {
          text: "Head of Sales",
          confidence: 0.95,
          bounds: { x: 30, y: 74, width: 220, height: 28 }
        },
        {
          text: "Jane Doe",
          confidence: 0.97,
          bounds: { x: 30, y: 108, width: 180, height: 40 }
        },
        {
          text: "jane@example.com",
          confidence: 0.99,
          bounds: { x: 30, y: 154, width: 220, height: 24 }
        }
      ]
    });

    const draft = await scanBusinessCard({
      originalBuffer: Buffer.from("original"),
      originalMimeType: "image/jpeg",
      correctedBuffer: Buffer.from("corrected"),
      correctedMimeType: "image/jpeg"
    });

    expect(mocks.putObject).toHaveBeenCalledTimes(2);
    expect(mocks.recognize).toHaveBeenCalledWith({
      buffer: Buffer.from("corrected"),
      mimeType: "image/jpeg"
    });
    expect(mocks.signDraftToken).toHaveBeenCalledOnce();
    expect(draft).toMatchObject({
      draftToken: "draft-token",
      fullName: "Jane Doe",
      organization: "ACME Inc. Platform Division",
      jobTitle: "Head of Sales",
      email: "jane@example.com",
      tempImageUrl: expect.stringContaining("/api/assets/drafts/")
    });
  });
});

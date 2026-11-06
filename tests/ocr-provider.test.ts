// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ annotate: vi.fn() }));
vi.mock("@google-cloud/vision", () => ({
  ImageAnnotatorClient: class {
    batchAnnotateImages = mocks.annotate;
  },
  protos: {},
}));
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("OCR_PROVIDER", "google");
  vi.stubEnv("GOOGLE_CLOUD_CREDENTIALS_JSON", "");
  mocks.annotate.mockReset();
});
it("sends one DOCUMENT_TEXT_DETECTION feature with a bounded timeout and no SDK retries", async () => {
  mocks.annotate.mockResolvedValue([
    {
      responses: [
        {
          fullTextAnnotation: {
            text: "山田 花子\nhanako@example.test",
            pages: [],
          },
        },
      ],
    },
  ]);
  const { getOcrClient } = await import("@/lib/ocr");
  const buffer = Buffer.from("image");
  expect(
    (await getOcrClient().recognize({ buffer, mimeType: "image/jpeg" }))
      .rawText,
  ).toContain("山田 花子");
  expect(mocks.annotate).toHaveBeenCalledExactlyOnceWith(
    {
      requests: [
        {
          image: { content: buffer },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          imageContext: { languageHints: ["ja", "en"] },
        },
      ],
    },
    { timeout: 35000, retry: null },
  );
});
it("preserves provider error codes for safe scan error classification", async () => {
  mocks.annotate.mockResolvedValue([
    {
      responses: [
        { error: { code: 7, message: "billing disabled in private-project" } },
      ],
    },
  ]);
  const { getOcrClient } = await import("@/lib/ocr");
  await expect(
    getOcrClient().recognize({
      buffer: Buffer.from("image"),
      mimeType: "image/jpeg",
    }),
  ).rejects.toMatchObject({ code: 7 });
});

it("uses Vision breaks instead of inserting spaces between Japanese words", async () => {
  const word = (text: string, type?: number, isPrefix = false) => ({
    symbols: [...text].map((character, index) => ({
      text: character,
      ...(index === text.length - 1 && type !== undefined
        ? { property: { detectedBreak: { type, isPrefix } } }
        : {}),
    })),
  });
  const rawText = "株式会社サンプル\nJohn Smith\n営業課";
  mocks.annotate.mockResolvedValue([{ responses: [{ fullTextAnnotation: {
    text: rawText,
    pages: [{ blocks: [{ paragraphs: [{ words: [
      word("株式"), word("会社"), word("サンプル", 5),
      word("John", 1), word("Smith", 3), word("営業"), word("課"),
    ] }] }] }],
  } }] }]);
  const { getOcrClient } = await import("@/lib/ocr");
  const result = await getOcrClient().recognize({ buffer: Buffer.from("image"), mimeType: "image/jpeg" });
  expect(result.rawText).toBe(rawText);
  expect(result.blocks[0].text).toBe(rawText);
});

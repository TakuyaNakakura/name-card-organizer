import { ImageAnnotatorClient, protos } from "@google-cloud/vision";

import { getOcrProvider, getOptionalEnv } from "@/lib/env";
import type { OcrBlock, OcrBounds, OcrResult } from "@/lib/types";

interface OcrProvider {
  recognize(input: { buffer: Buffer; mimeType: string }): Promise<OcrResult>;
}

class MockOcrProvider implements OcrProvider {
  async recognize(): Promise<OcrResult> {
    const rawText = getOptionalEnv(
      "MOCK_OCR_TEXT",
      "Jane Doe\njane@example.com",
    ).replaceAll("\\n", "\n");
    return {
      rawText,
      overallConfidence: 0.92,
      blocks: [
        {
          text: "Jane Doe",
          confidence: 0.95,
          bounds: { x: 48, y: 24, width: 220, height: 42 },
        },
        {
          text: "jane@example.com",
          confidence: 0.98,
          bounds: { x: 48, y: 92, width: 260, height: 28 },
        },
      ],
    };
  }
}

function readVertexBounds(
  vertices: protos.google.cloud.vision.v1.IBoundingPoly["vertices"],
): OcrBounds {
  const xs = (vertices ?? []).map((vertex) => vertex.x ?? 0);
  const ys = (vertices ?? []).map((vertex) => vertex.y ?? 0);
  const minX = xs.length ? Math.min(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function blockToText(block: protos.google.cloud.vision.v1.IBlock) {
  const paragraphs = block.paragraphs ?? [];

  return paragraphs
    .map((paragraph) =>
      (paragraph.words ?? [])
        .map((word) =>
          (word.symbols ?? []).map((symbol) => {
            const detectedBreak = symbol.property?.detectedBreak;
            const type = detectedBreak?.type;
            const separator = type === 1 || type === 2 || type === "SPACE" || type === "SURE_SPACE"
              ? " "
              : type === 3 || type === 5 || type === "EOL_SURE_SPACE" || type === "LINE_BREAK"
                ? "\n"
                : type === 4 || type === "HYPHEN" ? "-\n" : "";
            return detectedBreak?.isPrefix
              ? separator + (symbol.text ?? "")
              : (symbol.text ?? "") + separator;
          }).join(""),
        )
        .join(""),
    )
    .join("\n")
    .trim();
}

function flattenBlocks(
  pages: protos.google.cloud.vision.v1.IPage[] | null | undefined,
): OcrBlock[] {
  return (pages ?? []).flatMap((page) =>
    (page.blocks ?? [])
      .map((block) => ({
        text: blockToText(block),
        confidence: block.confidence ?? 0.7,
        bounds: readVertexBounds(block.boundingBox?.vertices),
      }))
      .filter((block) => block.text.length > 0),
  );
}

class GoogleVisionProvider implements OcrProvider {
  private client: ImageAnnotatorClient;

  constructor() {
    const credentialsJson = getOptionalEnv("GOOGLE_CLOUD_CREDENTIALS_JSON");
    this.client = credentialsJson
      ? new ImageAnnotatorClient({
          credentials: JSON.parse(credentialsJson),
        })
      : new ImageAnnotatorClient();
  }

  async recognize(input: {
    buffer: Buffer;
    mimeType: string;
  }): Promise<OcrResult> {
    // One image / one OCR feature. Disable SDK retries to avoid unrequested billable retries.
    const [batch] = await this.client.batchAnnotateImages(
      {
        requests: [
          {
            image: { content: input.buffer },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            imageContext: { languageHints: ["ja", "en"] },
          },
        ],
      },
      { timeout: 35_000, retry: null },
    );
    const response = batch.responses?.[0];
    if (!response) throw new Error("Google Vision returned no image response");

    if (response.error?.code) {
      throw Object.assign(
        new Error(
          response.error.message || "Google Vision failed to annotate image",
        ),
        {
          code: response.error.code,
        },
      );
    }

    const annotation = response.fullTextAnnotation;
    const blocks = flattenBlocks(annotation?.pages);

    return {
      rawText: annotation?.text?.trim() ?? "",
      blocks,
      overallConfidence:
        blocks.reduce((sum, block) => sum + block.confidence, 0) /
          Math.max(blocks.length, 1) || 0,
    };
  }
}

let ocrProvider: OcrProvider | null = null;

export function getOcrClient(): OcrProvider {
  if (!ocrProvider) {
    ocrProvider =
      getOcrProvider() === "google"
        ? new GoogleVisionProvider()
        : new MockOcrProvider();
  }

  return ocrProvider;
}

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

export const runtime = "nodejs";

const require = createRequire(import.meta.url);
const runtimeFilePath = require.resolve("@techstark/opencv-js/dist/opencv.js");

export async function GET() {
  const script = await readFile(runtimeFilePath, "utf8");

  return new Response(script, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}

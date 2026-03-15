import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function GET() {
  const filePath = path.join(
    process.cwd(),
    "node_modules",
    "@techstark",
    "opencv-js",
    "dist",
    "opencv.js"
  );
  const script = await readFile(filePath, "utf8");

  return new Response(script, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}

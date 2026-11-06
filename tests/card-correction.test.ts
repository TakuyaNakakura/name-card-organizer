// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { createRequire } from "node:module";
import { detectQuad } from "@/components/scan/camera-utils";
import type { Point } from "@/lib/card-detection";
import { texturedCardContent, texturedCardCorners as corners } from "./fixtures/textured-card";

let cv: Record<string, any>;
beforeAll(async () => {
  cv = await createRequire(import.meta.url)("@techstark/opencv-js");
});

async function detectSvg(content: string) {
  const { data } = await sharp(Buffer.from(`<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg">${content}</svg>`))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const runtime = Object.create(cv);
  runtime.imread = () => cv.matFromArray(480, 640, cv.CV_8UC4, data);
  return detectQuad(runtime, { width: 640, height: 480 } as HTMLCanvasElement);
}

describe("actual OpenCV card contour detection", () => {
  it("finds the true trapezoid corners when wood grain connects to the outer contour", async () => {
    const quad = await detectSvg(texturedCardContent);
    expect(quad).not.toBeNull();
    quad!.points.forEach((point: Point, index: number) => {
      expect(Math.hypot(point.x - corners[index].x, point.y - corners[index].y)).toBeLessThan(12);
    });
  });

  it("does not substitute a bounding rectangle for a curved non-card object", async () => {
    const quad = await detectSvg('<rect width="640" height="480" fill="#222"/><ellipse cx="320" cy="240" rx="220" ry="130" fill="#eee"/>');
    expect(quad).toBeNull();
  });
});

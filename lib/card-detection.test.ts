import { describe, expect, it } from "vitest";

import {
  areQuadsStable,
  calculateAspectRatio,
  isBusinessCardRatio,
  normalizeQuadrilateral,
  scoreQuadrilateral
} from "@/lib/card-detection";

describe("card detection helpers", () => {
  it("normalizes points into clockwise quadrilateral order", () => {
    const quad = normalizeQuadrilateral([
      { x: 360, y: 240 },
      { x: 40, y: 40 },
      { x: 380, y: 40 },
      { x: 20, y: 240 }
    ]);

    expect(quad.points[0]).toEqual({ x: 40, y: 40 });
    expect(quad.points[1]).toEqual({ x: 380, y: 40 });
    expect(quad.points[2]).toEqual({ x: 360, y: 240 });
    expect(quad.points[3]).toEqual({ x: 20, y: 240 });
  });

  it("accepts business-card-like aspect ratios", () => {
    const ratio = calculateAspectRatio(
      normalizeQuadrilateral([
        { x: 0, y: 0 },
        { x: 350, y: 0 },
        { x: 350, y: 200 },
        { x: 0, y: 200 }
      ])
    );

    expect(ratio).toBeCloseTo(1.75, 2);
    expect(
      isBusinessCardRatio(
        normalizeQuadrilateral([
          { x: 0, y: 0 },
          { x: 350, y: 0 },
          { x: 350, y: 200 },
          { x: 0, y: 200 }
        ])
      )
    ).toBe(true);
    expect(
      isBusinessCardRatio(
        normalizeQuadrilateral([
          { x: 0, y: 0 },
          { x: 180, y: 0 },
          { x: 180, y: 180 },
          { x: 0, y: 180 }
        ])
      )
    ).toBe(false);
  });

  it("scores large well-proportioned cards higher than off-ratio candidates", () => {
    const strong = normalizeQuadrilateral([
      { x: 20, y: 20 },
      { x: 420, y: 20 },
      { x: 420, y: 250 },
      { x: 20, y: 250 }
    ]);
    const weak = normalizeQuadrilateral([
      { x: 20, y: 20 },
      { x: 220, y: 20 },
      { x: 220, y: 220 },
      { x: 20, y: 220 }
    ]);

    expect(scoreQuadrilateral(strong, 480, 320)).toBeGreaterThan(
      scoreQuadrilateral(weak, 480, 320)
    );
  });

  it("treats nearby detections as stable", () => {
    const previous = normalizeQuadrilateral([
      { x: 30, y: 30 },
      { x: 370, y: 30 },
      { x: 360, y: 220 },
      { x: 20, y: 220 }
    ]);
    const next = normalizeQuadrilateral([
      { x: 34, y: 34 },
      { x: 374, y: 32 },
      { x: 364, y: 224 },
      { x: 22, y: 224 }
    ]);

    expect(areQuadsStable(previous, next)).toBe(true);
  });
});

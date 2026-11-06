import { describe, expect, it } from "vitest";

import {
  areQuadsStable,
  calculateAspectRatio,
  isBusinessCardRatio,
  normalizeQuadrilateral,
  scoreQuadrilateral,
  isQuadInsideFrame
} from "@/lib/card-detection";

describe("card detection helpers", () => {
  it.each([
    [{ x: NaN, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }],
    [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 60 }],
    [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 10 }, { x: 0, y: 60 }],
  ])("rejects invalid or concave corners", (...points) => {
    expect(() => normalizeQuadrilateral(points)).toThrow();
  });

  it("rejects clipped cards and accepts tilted cards fully within the frame", () => {
    const clipped = normalizeQuadrilateral([{ x: -5, y: 20 }, { x: 380, y: 20 }, { x: 380, y: 240 }, { x: -5, y: 240 }]);
    expect(isQuadInsideFrame(clipped, 640, 480)).toBe(false);
    expect(scoreQuadrilateral(clipped, 640, 480)).toBe(0);
    const tilted = normalizeQuadrilateral([{ x: 100, y: 180 }, { x: 450, y: 60 }, { x: 520, y: 260 }, { x: 170, y: 380 }]);
    expect(isQuadInsideFrame(tilted, 640, 480)).toBe(true);
    expect(scoreQuadrilateral(tilted, 640, 480)).toBeGreaterThan(0);
  });

  it("does not lock a rotating card just because its center and area are unchanged", () => {
    const points = [{ x: 130, y: 130 }, { x: 510, y: 130 }, { x: 510, y: 350 }, { x: 130, y: 350 }];
    const angle = Math.PI / 9;
    const rotated = points.map((point) => ({
      x: 320 + (point.x - 320) * Math.cos(angle) - (point.y - 240) * Math.sin(angle),
      y: 240 + (point.x - 320) * Math.sin(angle) + (point.y - 240) * Math.cos(angle),
    }));
    expect(areQuadsStable(normalizeQuadrilateral(points), normalizeQuadrilateral(rotated))).toBe(false);
  });
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

export interface Point {
  x: number;
  y: number;
}

export interface Quadrilateral {
  points: [Point, Point, Point, Point];
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centroid(points: Point[]) {
  return points.reduce(
    (sum, point) => ({
      x: sum.x + point.x / points.length,
      y: sum.y + point.y / points.length
    }),
    { x: 0, y: 0 }
  );
}

export function normalizeQuadrilateral(points: Point[]): Quadrilateral {
  if (points.length !== 4 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error("Quadrilateral requires four finite points");
  }

  const center = centroid(points);
  const sorted = [...points].sort((left, right) => {
    const leftAngle = Math.atan2(left.y - center.y, left.x - center.x);
    const rightAngle = Math.atan2(right.y - center.y, right.x - center.x);
    return leftAngle - rightAngle;
  });

  const topLeftIndex = sorted.reduce((bestIndex, point, index, source) => {
    const best = source[bestIndex];
    return point.x + point.y < best.x + best.y ? index : bestIndex;
  }, 0);

  const rotated = sorted
    .slice(topLeftIndex)
    .concat(sorted.slice(0, topLeftIndex)) as [Point, Point, Point, Point];

  const quad = { points: rotated };
  if (!hasValidCorners(quad)) throw new Error("Quadrilateral must be convex with four distinct corners");
  return quad;
}

function hasValidCorners(quad: Quadrilateral) {
  let direction = 0;
  for (let index = 0; index < 4; index++) {
    const a = quad.points[index], b = quad.points[(index + 1) % 4], c = quad.points[(index + 2) % 4];
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite) || distance(a, b) < 2) return false;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1 || (direction && Math.sign(cross) !== direction)) return false;
    direction = Math.sign(cross);
  }
  return true;
}

export function isQuadInsideFrame(quad: Quadrilateral, width: number, height: number) {
  const margin = Math.max(2, Math.min(width, height) * 0.012);
  return hasValidCorners(quad) && quad.points.every((point) =>
    point.x >= margin && point.y >= margin && point.x <= width - margin && point.y <= height - margin,
  );
}

export function calculateAspectRatio(quad: Quadrilateral) {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad.points;
  const width = (distance(topLeft, topRight) + distance(bottomLeft, bottomRight)) / 2;
  const height = (distance(topLeft, bottomLeft) + distance(topRight, bottomRight)) / 2;
  if (height === 0) {
    return 0;
  }

  const ratio = width >= height ? width / height : height / width;
  return Number(ratio.toFixed(2));
}

export function quadrilateralArea(quad: Quadrilateral) {
  const points = quad.points;
  const area = Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2
  );

  return area;
}

export function isBusinessCardRatio(quad: Quadrilateral) {
  const ratio = calculateAspectRatio(quad);
  return ratio >= 1.35 && ratio <= 2.25;
}

export function scoreQuadrilateral(
  quad: Quadrilateral,
  frameWidth: number,
  frameHeight: number
) {
  if (!isQuadInsideFrame(quad, frameWidth, frameHeight) || !isBusinessCardRatio(quad)) {
    return 0;
  }

  const areaScore = quadrilateralArea(quad) / Math.max(frameWidth * frameHeight, 1);
  const ratioPenalty = Math.abs(calculateAspectRatio(quad) - 1.75) * 0.25;

  return Number(Math.max(areaScore - ratioPenalty, 0).toFixed(3));
}

export function areQuadsStable(
  previous: Quadrilateral | null,
  next: Quadrilateral
) {
  if (!previous) {
    return false;
  }

  const previousCenter = centroid(previous.points);
  const nextCenter = centroid(next.points);
  const previousArea = quadrilateralArea(previous);
  const nextArea = quadrilateralArea(next);
  const centerDistance = distance(previousCenter, nextCenter);
  const areaDelta = Math.abs(previousArea - nextArea) / Math.max(previousArea, 1);

  const cornerDelta = Math.max(...previous.points.map((point, index) => distance(point, next.points[index])));
  return centerDistance < 24 && areaDelta < 0.18 &&
    cornerDelta / Math.max(Math.sqrt(previousArea), 1) < 0.055;
}

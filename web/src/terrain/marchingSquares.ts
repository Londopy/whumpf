// Original marching-triangles isoline extraction (each grid cell split into
// two triangles along one diagonal). Triangles have no ambiguous ("saddle")
// cases the way square-cell marching squares does, which keeps this simple
// and unambiguous — deliberately not using any third-party marching-squares
// library, several of which are AGPL-licensed and unsuitable for bundling
// into a distributed application.

export type Point = [number, number];
export interface Segment {
  a: Point;
  b: Point;
}

function interpolate(v0: number, p0: Point, v1: number, p1: Point, threshold: number): Point {
  const frac = (threshold - v0) / (v1 - v0);
  return [p0[0] + frac * (p1[0] - p0[0]), p0[1] + frac * (p1[1] - p0[1])];
}

function triangleIsoline(
  v0: number,
  p0: Point,
  v1: number,
  p1: Point,
  v2: number,
  p2: Point,
  threshold: number,
): Segment | null {
  const above = [v0 >= threshold, v1 >= threshold, v2 >= threshold];
  const count = above.filter(Boolean).length;
  if (count === 0 || count === 3) return null;

  const vals = [v0, v1, v2];
  const pts = [p0, p1, p2];
  const minorityIsAbove = count === 1;
  const minorityIdx = above.findIndex((v) => v === minorityIsAbove);
  const others = [0, 1, 2].filter((i) => i !== minorityIdx);

  const a = interpolate(vals[minorityIdx], pts[minorityIdx], vals[others[0]], pts[others[0]], threshold);
  const b = interpolate(vals[minorityIdx], pts[minorityIdx], vals[others[1]], pts[others[1]], threshold);
  return { a, b };
}

/**
 * Extracts isoline segments from a scalar grid at the given threshold.
 * Grid is a flat row-major array of `width*height` values; returned segment
 * coordinates are in grid space (col, row), including fractional positions.
 */
export function extractIsolineSegments(
  grid: Float32Array,
  width: number,
  height: number,
  threshold: number,
): Segment[] {
  const segments: Segment[] = [];

  for (let i = 0; i < height - 1; i++) {
    for (let j = 0; j < width - 1; j++) {
      const a = grid[i * width + j];
      const b = grid[i * width + j + 1];
      const c = grid[(i + 1) * width + j + 1];
      const d = grid[(i + 1) * width + j];

      const pA: Point = [j, i];
      const pB: Point = [j + 1, i];
      const pC: Point = [j + 1, i + 1];
      const pD: Point = [j, i + 1];

      // Split along the b-d diagonal into triangle (a,b,d) and (b,c,d).
      const seg1 = triangleIsoline(a, pA, b, pB, d, pD, threshold);
      if (seg1) segments.push(seg1);
      const seg2 = triangleIsoline(b, pB, c, pC, d, pD, threshold);
      if (seg2) segments.push(seg2);
    }
  }

  return segments;
}

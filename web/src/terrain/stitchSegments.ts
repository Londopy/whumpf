import type { Point, Segment } from "./marchingSquares";

function keyOf(p: Point): string {
  // Segments from adjacent marching-squares cells share exact interpolated
  // endpoints (same threshold, same corner values, same lerp formula), so a
  // small fixed-precision key is safe and avoids float-equality issues.
  return `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
}

/**
 * Joins disconnected 2-point isoline segments (one per marching-squares
 * cell) into long polylines by chaining shared endpoints. Cuts the feature
 * count by one to two orders of magnitude versus emitting every cell's
 * segment as its own feature, which matters both for render/GeoJSON-index
 * performance and so label placement (symbol-placement: line) has an
 * actual line to walk instead of thousands of 2-point fragments.
 */
export function stitchSegments(segments: Segment[]): Point[][] {
  const byPoint = new Map<string, { seg: Segment; end: "a" | "b" }[]>();
  for (const seg of segments) {
    const ka = keyOf(seg.a);
    const kb = keyOf(seg.b);
    if (!byPoint.has(ka)) byPoint.set(ka, []);
    if (!byPoint.has(kb)) byPoint.set(kb, []);
    byPoint.get(ka)!.push({ seg, end: "a" });
    byPoint.get(kb)!.push({ seg, end: "b" });
  }

  const used = new Set<Segment>();
  const lines: Point[][] = [];

  const otherEnd = (seg: Segment, fromEnd: "a" | "b"): Point => (fromEnd === "a" ? seg.b : seg.a);

  const popNextAt = (point: Point, exclude: Segment): { seg: Segment; end: "a" | "b" } | null => {
    const candidates = byPoint.get(keyOf(point));
    if (!candidates) return null;
    for (const c of candidates) {
      if (c.seg !== exclude && !used.has(c.seg)) return c;
    }
    return null;
  };

  for (const start of segments) {
    if (used.has(start)) continue;
    used.add(start);
    const chain: Point[] = [start.a, start.b];

    // Extend forward from the tail.
    let tailPoint = start.b;
    let lastSeg = start;
    for (;;) {
      const next = popNextAt(tailPoint, lastSeg);
      if (!next) break;
      used.add(next.seg);
      const nextPoint = otherEnd(next.seg, next.end);
      chain.push(nextPoint);
      tailPoint = nextPoint;
      lastSeg = next.seg;
      if (chain.length > 200000) break; // pathological-input guard
    }

    // Extend backward from the head.
    let headPoint = start.a;
    lastSeg = start;
    for (;;) {
      const next = popNextAt(headPoint, lastSeg);
      if (!next) break;
      used.add(next.seg);
      const nextPoint = otherEnd(next.seg, next.end);
      chain.unshift(nextPoint);
      headPoint = nextPoint;
      lastSeg = next.seg;
      if (chain.length > 200000) break;
    }

    lines.push(chain);
  }

  return lines;
}

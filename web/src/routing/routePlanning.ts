import type { RouteResult } from "../providers/RoutingProvider";

/**
 * Builds a client-side out-and-back route from a one-way point-to-point
 * result: the outbound leg plus its own reverse as the return leg. Real
 * geometry (not a fabricated shape) — ORS has no dedicated "out and back"
 * mode, so this is constructed from a real one-way route instead.
 *
 * waytypeBreakdown is intentionally dropped rather than mirrored: its
 * segment indices reference the one-way point array, and re-deriving
 * correct indices for the doubled-back array isn't worth the complexity
 * here — the route still renders and reports real distance/ascent/descent,
 * just without the trail/road color breakdown for this specific shape.
 */
export function buildOutAndBack(oneWay: RouteResult): RouteResult {
  const reversed = [...oneWay.points].reverse();
  const hasElevationStats = oneWay.ascentMeters !== undefined && oneWay.descentMeters !== undefined;
  return {
    points: [...oneWay.points, ...reversed.slice(1)],
    distanceMeters: oneWay.distanceMeters * 2,
    ascentMeters: hasElevationStats ? oneWay.ascentMeters! + oneWay.descentMeters! : undefined,
    descentMeters: hasElevationStats ? oneWay.descentMeters! + oneWay.ascentMeters! : undefined,
    durationSeconds: oneWay.durationSeconds !== undefined ? oneWay.durationSeconds * 2 : undefined,
  };
}

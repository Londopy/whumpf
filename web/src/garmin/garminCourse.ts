import type { LngLat, LngLatElevation } from "../providers/types";
import type { RouteResult } from "../providers/RoutingProvider";
import { haversineDistance } from "../geo/distance";

/**
 * Garmin-specific route representation — deliberately separate from the
 * core RouteResult/RouteEditorState (see providers/RoutingProvider.ts,
 * routing/routeReducer.ts). Nothing in src/garmin ever mutates or depends
 * on core route-planning state; a GarminCourse is only ever built at
 * export/upload time from whatever route is currently on screen, so
 * Garmin-specific concerns (course points, activity type, per-device size
 * limits) can't leak into or complicate the core route editor.
 */
export type GarminActivityType = "running" | "cycling" | "hiking" | "walking" | "other";

export const GARMIN_ACTIVITY_LABELS: Record<GarminActivityType, string> = {
  running: "Running",
  cycling: "Cycling",
  hiking: "Hiking",
  walking: "Walking",
  other: "Other",
};

/** A named point of interest along the course (start/finish/waypoint) —
 * distinct from the dense track geometry in `points`. Garmin's Courses API
 * and Garmin Connect's own GPX import both distinguish course points (named
 * POIs, shown on-device) from the track itself. `type` uses plain GPX
 * waypoint symbol conventions (widely honoured, incl. by Garmin Connect's
 * importer) rather than Garmin's undocumented-here proprietary course-point
 * icon set, which isn't guessed at. */
export type GarminCoursePointType = "start" | "finish" | "generic" | "summit" | "water" | "food" | "danger" | "first_aid";

export interface GarminCoursePoint {
  point: LngLat;
  name: string;
  type: GarminCoursePointType;
  /** Distance along the course from the start, in meters — Garmin course
   * points carry this so the device can announce/show them at the right
   * moment rather than just plotting a marker. */
  distanceMeters: number;
}

export interface GarminCourse {
  name: string;
  description: string;
  activityType: GarminActivityType;
  /** Dense track geometry — same points a RouteResult carries. */
  points: LngLatElevation[];
  coursePoints: GarminCoursePoint[];
  distanceMeters: number;
  ascentMeters?: number;
  descentMeters?: number;
}

export interface BuildGarminCourseOptions {
  name: string;
  description?: string;
  activityType: GarminActivityType;
  /** Route waypoints (start/intermediate/finish) — becomes course points.
   * Optional: an imported/generated route may have no editable waypoints,
   * only dense track geometry, in which case start/finish course points
   * are still derived from the track's first/last point. */
  waypoints?: LngLat[];
}

/** Finds how far along `points` a given point falls, by nearest-vertex
 * distance — good enough for course-point placement (not used for any
 * navigation-critical purpose). */
function distanceAlongTrack(points: LngLatElevation[], target: LngLat): number {
  if (points.length === 0) return 0;
  let nearestIndex = 0;
  let nearestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = haversineDistance(points[i], target);
    if (d < nearestDist) {
      nearestDist = d;
      nearestIndex = i;
    }
  }
  let cumulative = 0;
  for (let i = 1; i <= nearestIndex; i++) cumulative += haversineDistance(points[i - 1], points[i]);
  return cumulative;
}

/** Builds a GarminCourse from whatever route is currently on screen —
 * called only at export time, never stored as app state. */
export function buildGarminCourse(result: RouteResult, opts: BuildGarminCourseOptions): GarminCourse {
  const waypoints = opts.waypoints ?? [];
  const coursePoints: GarminCoursePoint[] = [];

  if (waypoints.length > 0) {
    waypoints.forEach((w, i) => {
      const isStart = i === 0;
      const isFinish = i === waypoints.length - 1;
      coursePoints.push({
        point: w,
        name: isStart ? "Start" : isFinish ? "Finish" : `Waypoint ${i + 1}`,
        type: isStart ? "start" : isFinish ? "finish" : "generic",
        distanceMeters: distanceAlongTrack(result.points, w),
      });
    });
  } else if (result.points.length > 0) {
    coursePoints.push({ point: result.points[0], name: "Start", type: "start", distanceMeters: 0 });
    coursePoints.push({
      point: result.points[result.points.length - 1],
      name: "Finish",
      type: "finish",
      distanceMeters: result.distanceMeters,
    });
  }

  return {
    name: opts.name.trim() || "Route",
    description: opts.description?.trim() ?? "",
    activityType: opts.activityType,
    points: result.points,
    coursePoints,
    distanceMeters: result.distanceMeters,
    ascentMeters: result.ascentMeters,
    descentMeters: result.descentMeters,
  };
}

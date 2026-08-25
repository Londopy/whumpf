import type { GarminCourse } from "./garminCourse";

export interface GarminValidationResult {
  errors: string[];
  warnings: string[];
}

// Garmin course size limits vary by device model and firmware — there is no
// single published universal number, so this is a conservative, clearly
// labeled heads-up rather than a claimed hard device limit.
const LARGE_TRACK_POINT_WARNING = 8000;
const MANY_COURSE_POINTS_WARNING = 50;

function isValidCoordinate(lng: number, lat: number): boolean {
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

/**
 * Validates a course before export — checked client-side, no network call.
 * Errors block export; warnings are shown but don't block it (the user may
 * still want the file, e.g. to trim it themselves before transferring).
 */
export function validateGarminCourse(course: GarminCourse): GarminValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Note: course.name can never be empty here — buildGarminCourse() (see
  // garminCourse.ts) already falls back to "Route" for a blank name, the
  // same default the app's other exporters use, so there's nothing to
  // validate here that isn't already guaranteed upstream.
  if (course.points.length < 2) errors.push("Route needs at least two points.");

  const invalidCoordCount = course.points.filter((p) => !isValidCoordinate(p.lng, p.lat)).length;
  if (invalidCoordCount > 0) errors.push(`${invalidCoordCount} point(s) have invalid coordinates.`);

  const withElevation = course.points.filter((p) => p.elevation !== undefined).length;
  if (withElevation === 0) {
    warnings.push("No elevation data — the course will import as a flat route (Garmin devices can still use it for navigation).");
  } else if (withElevation < course.points.length) {
    warnings.push(`${course.points.length - withElevation} of ${course.points.length} points are missing elevation.`);
  }

  if (course.points.length > LARGE_TRACK_POINT_WARNING) {
    warnings.push(
      `Route has ${course.points.length.toLocaleString()} track points — some Garmin device models cap course size and may reject or truncate very large courses (the exact limit varies by device).`,
    );
  }
  if (course.coursePoints.length > MANY_COURSE_POINTS_WARNING) {
    warnings.push(`Route has ${course.coursePoints.length} course points — some devices limit how many are shown.`);
  }

  if (course.distanceMeters <= 0) errors.push("Route has zero distance.");

  return { errors, warnings };
}

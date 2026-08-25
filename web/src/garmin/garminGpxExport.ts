import type { GarminCourse, GarminCoursePointType } from "./garminCourse";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Plain GPX waypoint <sym> values — standard Garmin GPX symbol names
// recognized broadly (incl. by Garmin Connect/BaseCamp's own importer),
// not Garmin's undocumented-here proprietary course-point extension.
const SYM_BY_TYPE: Record<GarminCoursePointType, string> = {
  start: "Flag, Green",
  finish: "Flag, Checkered",
  generic: "Waypoint",
  summit: "Summit",
  water: "Drinking Water",
  food: "Restaurant",
  danger: "Danger Area",
  first_aid: "First Aid",
};

function trkptXml(p: { lat: number; lng: number; elevation?: number }): string {
  const ele = p.elevation !== undefined ? `<ele>${p.elevation.toFixed(1)}</ele>` : "";
  return `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}">${ele}</trkpt>`;
}

function coursePointXml(cp: GarminCourse["coursePoints"][number]): string {
  return `  <wpt lat="${cp.point.lat.toFixed(7)}" lon="${cp.point.lng.toFixed(7)}">
    <name>${escapeXml(cp.name)}</name>
    <sym>${escapeXml(SYM_BY_TYPE[cp.type])}</sym>
  </wpt>`;
}

/**
 * Builds a standards-compliant GPX 1.1 document shaped for Garmin course
 * import: a named/described <trk> (with a <type> hint for activity) plus
 * one <wpt> per course point (start/finish/named waypoints), which is how
 * Garmin Connect's own GPX course importer, Garmin Express, and
 * device-storage drag-and-drop all expect course files to look — this is
 * the same public GPX 1.1 format Contour's regular route export already
 * uses (see gpx/gpxExport.ts), just with course-specific fields filled in.
 * No Garmin-proprietary extension schema is used, since that isn't
 * something we could verify here (see garmin/README notes in docs).
 */
export function buildGarminCourseGpx(course: GarminCourse): string {
  const createdAt = new Date();
  const coursePointsXml = course.coursePoints.map(coursePointXml).join("\n");
  const trackPointsXml = course.points.map(trkptXml).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Contour" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(course.name)}</name>
    ${course.description ? `<desc>${escapeXml(course.description)}</desc>` : ""}
    <time>${createdAt.toISOString()}</time>
  </metadata>
${coursePointsXml}
  <trk>
    <name>${escapeXml(course.name)}</name>
    <type>${escapeXml(course.activityType)}</type>
    <trkseg>
${trackPointsXml}
    </trkseg>
  </trk>
</gpx>
`;
}

export function suggestGarminGpxFilename(routeName: string): string {
  const safe = routeName.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "Route";
  return `${safe}_garmin_course.gpx`;
}

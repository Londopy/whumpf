/**
 * Rough hiking time estimate for manual/straight-line routes, where no
 * routing engine provides a real duration. A commonly used variant of
 * Naismith's rule: a base walking pace plus extra time per meter climbed.
 * Always presented in the UI as an estimate, not a measured value.
 */
export function estimateHikingDurationSeconds(distanceMeters: number, ascentMeters: number): number {
  const BASE_SPEED_KMH = 4.5;
  const SECONDS_PER_METER_ASCENT = 6; // ≈ 1 hour per 600m climbed
  const baseSeconds = (distanceMeters / 1000 / BASE_SPEED_KMH) * 3600;
  const ascentSeconds = Math.max(0, ascentMeters) * SECONDS_PER_METER_ASCENT;
  return baseSeconds + ascentSeconds;
}

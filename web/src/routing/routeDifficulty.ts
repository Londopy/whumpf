export type DifficultyLevel = "easy" | "moderate" | "hard" | "strenuous";

export interface DifficultyEstimate {
  level: DifficultyLevel;
  /** Cites the route's own numbers, not a vague label — e.g. "9.2 km with
   * 450 m ascent, max grade 18%" — so the estimate is checkable against the
   * stats shown right next to it. */
  reason: string;
}

export const DIFFICULTY_LABEL: Record<DifficultyLevel, string> = {
  easy: "Easy",
  moderate: "Moderate",
  hard: "Hard",
  strenuous: "Strenuous",
};

/**
 * A simple, transparent difficulty heuristic from distance + total ascent +
 * max grade — NOT an official trail rating (SAC scale, Shenandoah system,
 * etc.), and not a safety certification. Always presented in the UI as
 * "estimated" with the reason spelled out, so it can be checked against the
 * route's own displayed numbers rather than trusted as an opaque score.
 */
export function estimateDifficulty(distanceMeters: number, ascentMeters: number, maxSlopePercent: number): DifficultyEstimate {
  const km = distanceMeters / 1000;
  let level: DifficultyLevel;
  if (km < 8 && ascentMeters < 300 && maxSlopePercent < 15) level = "easy";
  else if (km < 16 && ascentMeters < 700 && maxSlopePercent < 25) level = "moderate";
  else if (km < 24 && ascentMeters < 1200 && maxSlopePercent < 35) level = "hard";
  else level = "strenuous";

  const reason = `${km.toFixed(1)} km with ${Math.round(ascentMeters)} m ascent, max grade ${maxSlopePercent.toFixed(0)}%`;
  return { level, reason };
}

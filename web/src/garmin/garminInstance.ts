import { UnavailableGarminProvider } from "./GarminProvider";

// Single shared instance — see GarminProvider.ts for why this is the only
// implementation shipped (no Garmin Developer Program access available).
export const garminProvider = new UnavailableGarminProvider();

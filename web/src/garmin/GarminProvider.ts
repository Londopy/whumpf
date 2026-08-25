import type { GarminCourse } from "./garminCourse";

/**
 * Provider-agnostic interface for the Garmin Connect Developer Program's
 * Courses API — kept entirely separate from every other provider in
 * src/providers/ since Garmin's program has fundamentally different access
 * rules: it's business/enterprise-use only, requires a reviewed
 * application (Garmin confirms status within ~2 business days, then a
 * typical 1-4 week integration), uses OAuth 2.0, and — critically — has NO
 * public sandbox. Garmin's own developer docs describe access as
 * "development against the production environment with throttled access,"
 * granted only after approval (confirmed live against developer.garmin.com,
 * 2026-08-24). There is no tier of this that an unapproved application can
 * exercise, so this interface exists to be implemented later, not now.
 *
 * `UnavailableGarminProvider` below is the only implementation shipped —
 * every method reports the real reason it can't do anything, rather than
 * silently no-op'ing or faking success.
 */

export type GarminConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface GarminConnectionState {
  status: GarminConnectionStatus;
  /** Set on "error" or when "disconnected" has a specific known reason
   * (e.g. no developer approval) rather than just "never connected". */
  reason?: string;
}

export interface GarminUploadResult {
  courseId: string;
  name: string;
  uploadedAt: number;
}

export interface GarminUploadedCourseSummary {
  courseId: string;
  name: string;
  uploadedAt: number;
}

/** Thrown by provider methods — distinguishes the specific failure so the
 * UI can show a useful message instead of a generic "something went
 * wrong". */
export class GarminProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: "not_available" | "not_connected" | "auth_expired" | "rate_limited" | "network" | "rejected",
  ) {
    super(message);
    this.name = "GarminProviderError";
  }
}

export interface GarminProvider {
  readonly name: string;
  /** Whether this provider can do anything at all in this build — false
   * for UnavailableGarminProvider, since there's no way to know if a real
   * implementation would need e.g. a client ID until one exists. */
  readonly isConfigured: boolean;

  getConnectionState(): GarminConnectionState;
  /** Starts the OAuth 2.0 connect flow. A real implementation should use
   * Authorization Code + PKCE (no client secret embedded in the shipped
   * desktop app — see RFC 8252 for native-app OAuth best practice) and
   * persist the resulting token via a Tauri-backend-held secure store
   * (NOT browser localStorage, which is unencrypted and readable by any
   * script in the webview — see src/theme/ThemeContext.tsx for the only
   * existing persistence mechanism in this app today, which is
   * intentionally not reused here for exactly that reason). */
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  uploadCourse(course: GarminCourse): Promise<GarminUploadResult>;
  listCourses(): Promise<GarminUploadedCourseSummary[]>;
  deleteCourse(courseId: string): Promise<void>;
}

const NOT_AVAILABLE_REASON =
  "Garmin Courses API access requires an approved Garmin Connect Developer Program application (business/enterprise use, reviewed by Garmin) — not available in this build.";

/**
 * The only GarminProvider implementation shipped today. Every method
 * throws or rejects with the real reason rather than pretending to
 * succeed — see class doc above for why no other implementation exists
 * yet. Swap this for a real OAuth-backed implementation once Garmin
 * Developer Program credentials exist; nothing else in the app needs to
 * change, since everything consumes the GarminProvider interface, not
 * this class directly.
 */
export class UnavailableGarminProvider implements GarminProvider {
  readonly name = "Garmin Connect (not available)";
  readonly isConfigured = false;

  getConnectionState(): GarminConnectionState {
    return { status: "disconnected", reason: NOT_AVAILABLE_REASON };
  }

  async connect(): Promise<void> {
    throw new GarminProviderError(NOT_AVAILABLE_REASON, "not_available");
  }

  async disconnect(): Promise<void> {
    // Nothing to disconnect — never connected. Not an error to call this.
  }

  async uploadCourse(): Promise<GarminUploadResult> {
    throw new GarminProviderError(NOT_AVAILABLE_REASON, "not_available");
  }

  async listCourses(): Promise<GarminUploadedCourseSummary[]> {
    throw new GarminProviderError(NOT_AVAILABLE_REASON, "not_available");
  }

  async deleteCourse(): Promise<void> {
    throw new GarminProviderError(NOT_AVAILABLE_REASON, "not_available");
  }
}

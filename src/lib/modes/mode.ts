/**
 * Buddy Mode Registry — Single Source of Truth.
 *
 * Three operating modes:
 *   builder_observer — internal reliability + diagnostics
 *   banker_copilot   — trusted advisor UX + governed actions
 *   examiner_portal  — least privilege, scoped access, read-only
 *
 * Precedence: explicit env > role-based default
 *   - NEXT_PUBLIC_BUDDY_MODE env var (explicit)
 *   - dev environment → builder_observer
 *   - authenticated banker → banker_copilot
 *   - examiner scoped token → examiner_portal
 */

export type BuddyMode = "builder_observer" | "banker_copilot" | "examiner_portal";

const VALID_MODES: ReadonlySet<string> = new Set([
  "builder_observer",
  "banker_copilot",
  "examiner_portal",
]);

/**
 * Resolve the current Buddy mode.
 *
 * @param overrides - Optional overrides for testing or server-side resolution
 *   - envMode: value of NEXT_PUBLIC_BUDDY_MODE
 *   - role: authenticated user's role
 *   - hasExaminerGrant: whether an examiner grant token is present
 *   - isDev: whether running in development
 */
export function getBuddyMode(overrides?: {
  envMode?: string | null;
  role?: string | null;
  hasExaminerGrant?: boolean;
  isDev?: boolean;
}): BuddyMode {
  // 1. Explicit env override (highest precedence)
  const envMode = overrides?.envMode
    ?? (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_BUDDY_MODE : undefined);

  if (envMode && VALID_MODES.has(envMode)) {
    return envMode as BuddyMode;
  }

  // 2. Examiner grant token present → examiner_portal
  if (overrides?.hasExaminerGrant) {
    return "examiner_portal";
  }

  // 3. Role-based default
  const role = overrides?.role ?? null;
  if (role === "examiner") {
    return "examiner_portal";
  }
  if (role === "super_admin" || role === "bank_admin" || role === "underwriter") {
    return "banker_copilot";
  }

  // 4. Dev environment → builder_observer
  const isDev = overrides?.isDev
    ?? (typeof process !== "undefined" && process.env.NODE_ENV === "development");

  if (isDev) {
    return "builder_observer";
  }

  // 5. Default → banker_copilot (production authenticated users)
  return "banker_copilot";
}

/**
 * Check if a string is a valid BuddyMode.
 */
export function isBuddyMode(value: unknown): value is BuddyMode {
  return typeof value === "string" && VALID_MODES.has(value);
}

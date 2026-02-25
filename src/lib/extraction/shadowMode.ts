/**
 * Shadow Mode + Canary Rollout (H1-H2).
 *
 * Pure module — no server-only, no DB, safe for CI guard imports.
 *
 * Controls whether structured assist is in:
 * - SHADOW mode: run structured assist but don't persist facts from it
 * - CANARY mode: active assist only for internal/allowed deals
 * - ACTIVE mode: full production mode
 *
 * Shadow mode emits comparison events but never changes pipeline behavior.
 * Canary mode restricts active assist to a specific allow-list.
 */

// ── Types ─────────────────────────────────────────────────────────────

export type StructuredAssistMode = "shadow" | "canary" | "active";

// ── Configuration ───────────────────────────────────────────────────

/**
 * Determine the current structured assist mode.
 *
 * Priority:
 * 1. STRUCTURED_ASSIST_MODE env var (explicit override)
 * 2. Default to "active" (post-rollout)
 *
 * Valid values: "shadow", "canary", "active"
 */
export function getStructuredAssistMode(): StructuredAssistMode {
  const mode = (
    process.env.STRUCTURED_ASSIST_MODE ?? "active"
  ).toLowerCase().trim();

  if (mode === "shadow" || mode === "canary" || mode === "active") {
    return mode;
  }

  return "active";
}

/**
 * Check if a deal is in the canary allow-list.
 *
 * When mode=canary:
 * - If CANARY_DEAL_IDS is set → only those deal IDs get active assist
 * - If CANARY_BANK_IDS is set → only those bank IDs get active assist
 * - If CANARY_INTERNAL_ONLY=true → only internal deals get active assist
 *
 * Returns true if the deal is allowed for active structured assist.
 */
export function isCanaryAllowed(args: {
  dealId: string;
  bankId: string;
  isInternal?: boolean;
}): boolean {
  const mode = getStructuredAssistMode();

  // Active mode → always allowed
  if (mode === "active") return true;

  // Shadow mode → never use results (but still run for comparison)
  if (mode === "shadow") return false;

  // Canary mode → check allow-lists
  const canaryDealIds = process.env.CANARY_DEAL_IDS;
  if (canaryDealIds) {
    const allowed = canaryDealIds.split(",").map((s) => s.trim());
    if (allowed.includes(args.dealId)) return true;
  }

  const canaryBankIds = process.env.CANARY_BANK_IDS;
  if (canaryBankIds) {
    const allowed = canaryBankIds.split(",").map((s) => s.trim());
    if (allowed.includes(args.bankId)) return true;
  }

  if (process.env.CANARY_INTERNAL_ONLY === "true" && args.isInternal) {
    return true;
  }

  return false;
}

/**
 * Determine whether to USE structured assist results for a specific deal.
 *
 * In shadow mode: run structured assist but return null (comparison only).
 * In canary mode: only return results for allowed deals.
 * In active mode: always return results.
 */
export function shouldUseStructuredAssistResults(args: {
  dealId: string;
  bankId: string;
  isInternal?: boolean;
}): boolean {
  const mode = getStructuredAssistMode();

  if (mode === "shadow") return false;
  if (mode === "canary") return isCanaryAllowed(args);
  return true;
}

/**
 * Determine whether to RUN structured assist (even in shadow mode).
 * Shadow mode still runs structured assist — just doesn't use the results.
 */
export function shouldRunStructuredAssist(): boolean {
  // Always run — even in shadow mode (for comparison events)
  return true;
}

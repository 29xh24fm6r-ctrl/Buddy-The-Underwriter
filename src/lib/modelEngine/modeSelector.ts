/**
 * Model Engine — Centralized Mode Selector
 *
 * Single source of truth for engine mode determination.
 * Pure function (reads env vars only). Never duplicated.
 *
 * Phase 11: Non-ops contexts are enforced to v2_primary.
 * Only ops contexts (isOpsOverride=true) may resolve to V1 modes.
 *
 * Priority (ops context only):
 * 1. MODEL_ENGINE_PRIMARY (V1 | V2) — human-readable primary control
 * 2. MODEL_ENGINE_MODE env (fine-grained override: v1 | v2_shadow | v2_primary)
 * 3. V2_PRIMARY_DEAL_ALLOWLIST → v2_primary for listed deals
 * 4. V2_PRIMARY_BANK_ALLOWLIST → v2_primary for listed banks
 * 5. Default → v2_primary
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelEngineMode = "v1" | "v2_shadow" | "v2_primary";

export interface ModeSelectionContext {
  bankId?: string;
  dealId?: string;
  /** Set true for ops/admin endpoints that may need V1 comparison. */
  isOpsOverride?: boolean;
}

export interface ModeSelectionResult {
  mode: ModelEngineMode;
  reason: string;
}

// ---------------------------------------------------------------------------
// Allowlist parser (cached per process)
// ---------------------------------------------------------------------------

const allowlistCache = new Map<string, Set<string>>();

function parseAllowlist(envKey: string): Set<string> {
  const cached = allowlistCache.get(envKey);
  if (cached) return cached;

  const raw = process.env[envKey];
  if (!raw) {
    const empty = new Set<string>();
    allowlistCache.set(envKey, empty);
    return empty;
  }

  const set = new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  allowlistCache.set(envKey, set);
  return set;
}

// ---------------------------------------------------------------------------
// Mode selector
// ---------------------------------------------------------------------------

const VALID_MODES: ReadonlySet<string> = new Set(["v1", "v2_shadow", "v2_primary"]);

export function selectModelEngineMode(
  ctx?: ModeSelectionContext,
): ModeSelectionResult {
  // Phase 11: Non-ops contexts are enforced to v2_primary
  if (!ctx?.isOpsOverride) {
    return { mode: "v2_primary", reason: "enforced" };
  }

  // 1. MODEL_ENGINE_PRIMARY — human-readable primary control (highest priority)
  const primary = process.env.MODEL_ENGINE_PRIMARY;
  if (primary === "V1") {
    return { mode: "v1", reason: "env:MODEL_ENGINE_PRIMARY=V1" };
  }
  if (primary === "V2") {
    return { mode: "v2_primary", reason: "env:MODEL_ENGINE_PRIMARY=V2" };
  }

  // 2. MODEL_ENGINE_MODE — fine-grained override
  const explicit = process.env.MODEL_ENGINE_MODE;
  if (explicit && VALID_MODES.has(explicit)) {
    return { mode: explicit as ModelEngineMode, reason: `env:MODEL_ENGINE_MODE=${explicit}` };
  }

  // 3. Deal allowlist
  if (ctx?.dealId) {
    const dealAllowlist = parseAllowlist("V2_PRIMARY_DEAL_ALLOWLIST");
    if (dealAllowlist.has(ctx.dealId)) {
      return { mode: "v2_primary", reason: `deal_allowlist:${ctx.dealId}` };
    }
  }

  // 4. Bank allowlist
  if (ctx?.bankId) {
    const bankAllowlist = parseAllowlist("V2_PRIMARY_BANK_ALLOWLIST");
    if (bankAllowlist.has(ctx.bankId)) {
      return { mode: "v2_primary", reason: `bank_allowlist:${ctx.bankId}` };
    }
  }

  // 5. Default → v2_primary
  return { mode: "v2_primary", reason: "default" };
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/** Returns true if V2 is enabled in any mode (shadow or primary). */
export function isV2Enabled(ctx?: ModeSelectionContext): boolean {
  return selectModelEngineMode(ctx).mode !== "v1";
}

/** Returns true only if V2 is the primary engine for this context. */
export function isV2Primary(ctx?: ModeSelectionContext): boolean {
  return selectModelEngineMode(ctx).mode === "v2_primary";
}

/** Returns true if V1 rendering is disabled for user-facing surfaces. */
export function isV1RendererDisabled(): boolean {
  return process.env.V1_RENDERER_DISABLED === "true";
}

/** Returns true if legacy V1 shadow comparison is enabled alongside V2 primary. */
export function isShadowCompareEnabled(): boolean {
  return process.env.SHADOW_COMPARE === "true";
}

/**
 * Clear the allowlist cache. Used in tests to reset between env changes.
 * @internal
 */
export function _resetAllowlistCache(): void {
  allowlistCache.clear();
}

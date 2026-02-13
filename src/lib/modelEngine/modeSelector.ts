/**
 * Model Engine V2 — Centralized Mode Selector
 *
 * Single source of truth for engine mode determination.
 * Pure function (reads env vars only). Never duplicated.
 *
 * Priority:
 * 1. MODEL_ENGINE_MODE env (explicit override)
 * 2. V2_PRIMARY_DEAL_ALLOWLIST → v2_primary for listed deals
 * 3. V2_PRIMARY_BANK_ALLOWLIST → v2_primary for listed banks
 * 4. USE_MODEL_ENGINE_V2=true  → v2_shadow (backward compat)
 * 5. Default → v1
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelEngineMode = "v1" | "v2_shadow" | "v2_primary";

export interface ModeSelectionContext {
  bankId?: string;
  dealId?: string;
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
  // 1. Explicit mode override (highest priority)
  const explicit = process.env.MODEL_ENGINE_MODE;
  if (explicit && VALID_MODES.has(explicit)) {
    return { mode: explicit as ModelEngineMode, reason: `env:MODEL_ENGINE_MODE=${explicit}` };
  }

  // 2. Deal allowlist
  if (ctx?.dealId) {
    const dealAllowlist = parseAllowlist("V2_PRIMARY_DEAL_ALLOWLIST");
    if (dealAllowlist.has(ctx.dealId)) {
      return { mode: "v2_primary", reason: `deal_allowlist:${ctx.dealId}` };
    }
  }

  // 3. Bank allowlist
  if (ctx?.bankId) {
    const bankAllowlist = parseAllowlist("V2_PRIMARY_BANK_ALLOWLIST");
    if (bankAllowlist.has(ctx.bankId)) {
      return { mode: "v2_primary", reason: `bank_allowlist:${ctx.bankId}` };
    }
  }

  // 4. Legacy flag compat
  if (process.env.USE_MODEL_ENGINE_V2 === "true") {
    return { mode: "v2_shadow", reason: "env:USE_MODEL_ENGINE_V2=true" };
  }

  // 5. Default
  return { mode: "v1", reason: "default" };
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

/**
 * Clear the allowlist cache. Used in tests to reset between env changes.
 * @internal
 */
export function _resetAllowlistCache(): void {
  allowlistCache.clear();
}

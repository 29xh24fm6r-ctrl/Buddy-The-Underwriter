/**
 * SPEC-FINENGINE-MEMO-GATE-PARITY-1 — shared memo-generation preconditions.
 *
 * The two RENDERER-INDEPENDENT data-integrity gates that must hold before ANY
 * credit memo generates, regardless of which renderer (legacy Gemini narrative or
 * the finengine) draws it:
 *   1. research trust — block only on an explicit research FAIL (missing/absent
 *      research is allowed — the memo proceeds without it).
 *   2. validation pass — block only when the latest validation report's
 *      `gating_decision` is BLOCK_GENERATION (an absent report is allowed).
 *
 * Both the legacy and finengine branches of the generate route call THIS helper,
 * so the two implementations can't drift (build principle #17 — one source of
 * truth). The third legacy gate — the `ai_risk_runs` hard-require — is NOT here:
 * it is a legacy-renderer concern (the Gemini memo needs the LLM risk grade),
 * and the finengine path deliberately SUPERSEDES it with its own deterministic,
 * registry-driven riskRating (more SR 11-7-defensible — reproducible and
 * version-controlled than an LLM grade). That asymmetry is intentional, not a
 * skipped safety check.
 *
 * DB access is imported LAZILY in the default loaders, so this module stays
 * importable + unit-testable under the test runner (tests inject loaders).
 * Read-only — reads gate state, writes nothing.
 */

export type PreconditionResult = { allowed: boolean; status: number; error?: string };

export type PreconditionLoaders = {
  /** Research trust for the memo action — { allowed:false, reason } only on explicit FAIL. */
  loadResearchTrust?: (dealId: string) => Promise<{ allowed: boolean; reason?: string }>;
  /** Latest validation `gating_decision` for the deal, or null when no report exists. */
  loadValidationGating?: (dealId: string) => Promise<string | null>;
};

async function defaultLoadResearchTrust(dealId: string): Promise<{ allowed: boolean; reason?: string }> {
  const { loadAndEnforceResearchTrust } = await import("@/lib/research/trustEnforcement");
  const r = await loadAndEnforceResearchTrust(dealId, "memo");
  return r.allowed ? { allowed: true } : { allowed: false, reason: (r as { reason?: string }).reason };
}

async function defaultLoadValidationGating(dealId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const sb = supabaseAdmin();
  const { data } = await (sb as any)
    .from("buddy_validation_reports")
    .select("gating_decision")
    .eq("deal_id", dealId)
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.gating_decision ?? null;
}

/**
 * Enforce the renderer-independent memo-generation preconditions. Returns
 * `{ allowed:true }` when both gates pass (including the OmniCare shape: no
 * validation report + completed research), else `{ allowed:false, status, error }`.
 */
export async function enforceMemoGenerationPreconditions(
  dealId: string,
  loaders?: PreconditionLoaders,
): Promise<PreconditionResult> {
  // 1) Research trust — block only on explicit FAIL.
  const trust = await (loaders?.loadResearchTrust ?? defaultLoadResearchTrust)(dealId);
  if (!trust.allowed) {
    return { allowed: false, status: 400, error: trust.reason ?? "Cannot generate memo: research trust failed." };
  }

  // 2) Validation pass — block only on BLOCK_GENERATION.
  const gating = await (loaders?.loadValidationGating ?? defaultLoadValidationGating)(dealId);
  if (gating === "BLOCK_GENERATION") {
    return { allowed: false, status: 400, error: "Validation has flagged blocking issues. Resolve them before generating memo." };
  }

  return { allowed: true, status: 200 };
}

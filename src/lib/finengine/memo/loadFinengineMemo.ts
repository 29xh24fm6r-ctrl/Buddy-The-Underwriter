/**
 * SPEC-FINENGINE-MEMO-CUTOVER-1 — Phase 4: the production memo selector + loader.
 *
 * The live route asks `memoRenderSource(bankId)` which path to use. Default is
 * 'legacy' (the classicSpread renderer, unchanged) — a tenant routes to
 * 'finengine' only once its `memo_engine_cutover` flag is flipped ON. When ON,
 * `loadFinengineMemo` loads the deal's certified facts, builds the engine memo
 * package, and exposes the cutover gate so the submit path can enforce it.
 *
 * The DB access (supabaseAdmin) is imported LAZILY inside the default loaders, so
 * this module stays importable + unit-testable under the test runner: tests
 * inject `loadRows`/`loadMeta` and never touch the server-only client. Read-only.
 */

import { buildFinengineMemoPackage, resolveBorrowerLabel, type MemoSignals, type FinengineMemoPackage } from "@/lib/finengine/memo/finengineMemoPackage";
import { isMemoEngineCutOver, type TenantMemoCutoverFlags } from "@/lib/finengine/featureFlags";
import type { MemoInputs } from "@/lib/finengine/memo/buildCreditMemo";
import type { HardAnchor } from "@/lib/finengine/spread/validateSpread";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";
import { getIndustryProfile } from "@/lib/industryIntelligence/naicsMapper";

export type MemoRenderSource = "finengine" | "legacy";

/** Which renderer a tenant gets. Defaults to 'legacy' (the unchanged classicSpread path). */
export function memoRenderSource(bankId: string | null | undefined, flags?: TenantMemoCutoverFlags): MemoRenderSource {
  return isMemoEngineCutOver(bankId, flags) ? "finengine" : "legacy";
}

/**
 * Resolve the per-tenant cutover flags from env (a comma-separated bank-id
 * allowlist in MEMO_ENGINE_CUTOVER_TENANTS). Absent ⇒ {} ⇒ every tenant OFF.
 * Flipping a tenant ON = add its id to the env var; reverting = remove it.
 */
export function resolveMemoCutoverFlags(env: Record<string, string | undefined> = process.env): TenantMemoCutoverFlags {
  const raw = env.MEMO_ENGINE_CUTOVER_TENANTS;
  if (!raw) return {};
  const flags: TenantMemoCutoverFlags = {};
  for (const id of raw.split(",").map((s) => s.trim()).filter(Boolean)) flags[id] = true;
  return flags;
}

export type DealMemoMeta = { display_name?: string | null; borrower_name?: string | null; name?: string | null; entityForm?: string | null };

export type LoadFinengineMemoOpts = {
  bankId?: string | null;
  signals?: MemoSignals;
  hardAnchors?: HardAnchor[];
  /** Caller-supplied non-financial MemoInputs (request, sources/uses, …); borrower is filled from meta. */
  base?: Partial<MemoInputs>;
  /** Injectable for tests; defaults to the supabaseAdmin-backed loaders. */
  loadRows?: (dealId: string) => Promise<CertifiedFactRow[]>;
  loadMeta?: (dealId: string) => Promise<DealMemoMeta>;
  /** Resolve the deal's NAICS code (industry-calibrated reasonableness). Injectable for tests. */
  loadNaics?: (dealId: string) => Promise<string | null>;
};

async function defaultLoadRows(dealId: string): Promise<CertifiedFactRow[]> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const sb = supabaseAdmin();
  const { data, error } = await (sb as any)
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num, fact_value_text, fact_period_end, owner_type, is_superseded, source_canonical_type, confidence, provenance, source_document_id, created_at")
    .eq("deal_id", dealId)
    // Keep numeric facts AND categorical facts (e.g. ACCOUNTING_BASIS carries
    // fact_value_text with a null fact_value_num) — the basis resolver needs them.
    .or("fact_value_num.not.is.null,fact_value_text.not.is.null");
  if (error) throw new Error(`[loadFinengineMemo] load ${dealId}: ${error.message}`);
  return ((data ?? []) as any[]).map((r) => ({
    fact_key: r.fact_key,
    fact_value_num: r.fact_value_num == null ? null : Number(r.fact_value_num),
    fact_value_text: r.fact_value_text ?? null,
    fact_period_end: r.fact_period_end,
    owner_type: r.owner_type,
    is_superseded: !!r.is_superseded,
    source_canonical_type: r.source_canonical_type ?? null,
    confidence: r.confidence == null ? null : Number(r.confidence),
    extractor: r.provenance?.extractor ?? null,
    source_document_id: r.source_document_id ?? null,
    created_at: r.created_at ?? null,
  }));
}

async function defaultLoadMeta(dealId: string): Promise<DealMemoMeta> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const sb = supabaseAdmin();
  const { data } = await (sb as any).from("deals").select("display_name, borrower_name, name").eq("id", dealId).maybeSingle();
  return (data ?? {}) as DealMemoMeta;
}

/**
 * Resolve the deal's NAICS code. `deal_borrower_story.naics_code` is the
 * canonical, deal-scoped source (it carries naics_source/naics_confidence);
 * `borrowers.naics_code` is the fallback when the story has none. Returns null
 * when neither is present ⇒ caller falls through to the default industry profile.
 */
async function defaultLoadNaics(dealId: string): Promise<string | null> {
  // Advisory: industry calibration is a refinement, never a gate. Any failure
  // here (missing env, table, row) degrades to the default profile — it must
  // NOT break memo loading (R3).
  try {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const sb = supabaseAdmin();
    const { data: story } = await (sb as any)
      .from("deal_borrower_story")
      .select("naics_code")
      .eq("deal_id", dealId)
      .maybeSingle();
    const storyNaics = (story?.naics_code ?? "").trim();
    if (storyNaics) return storyNaics;

    const { data: deal } = await (sb as any).from("deals").select("borrower_id").eq("id", dealId).maybeSingle();
    if (!deal?.borrower_id) return null;
    const { data: borrower } = await (sb as any)
      .from("borrowers")
      .select("naics_code")
      .eq("id", deal.borrower_id)
      .maybeSingle();
    const borrowerNaics = (borrower?.naics_code ?? "").trim();
    return borrowerNaics || null;
  } catch {
    return null;
  }
}

/** The persisted/returned memo shape the generate route uses: `{ sections: [...] }`. */
export type RenderedMemo = { sections: Array<{ key: string; title: string; body: string }>; source: "finengine" };

/**
 * Shape a finengine memo package into the generate route's `memo` payload — the
 * same `{ sections }` contract the legacy Gemini path persists/returns, so a
 * flipped-on tenant's memo slots in without a schema change. Only populated
 * sections are emitted (an empty section renders its "data not yet available"
 * body in buildCreditMemo, which we keep so the structure is stable). Pure.
 */
export function renderFinengineMemoNarrative(pkg: FinengineMemoPackage): RenderedMemo {
  return {
    sections: pkg.memo.sections.map((s) => ({ key: s.key, title: s.title, body: s.body })),
    source: "finengine",
  };
}

/**
 * Build the finengine memo package for a deal (the ON path). Pure orchestration
 * over injectable loaders; read-only (NG1 — writes nothing).
 */
export async function loadFinengineMemo(dealId: string, opts: LoadFinengineMemoOpts = {}): Promise<FinengineMemoPackage> {
  const rows = await (opts.loadRows ?? defaultLoadRows)(dealId);
  const meta = await (opts.loadMeta ?? defaultLoadMeta)(dealId);
  const naics = await (opts.loadNaics ?? defaultLoadNaics)(dealId);
  const base: MemoInputs = {
    ...(opts.base as MemoInputs | undefined),
    borrower: { displayName: resolveBorrowerLabel(meta), entityForm: meta.entityForm ?? opts.base?.borrower?.entityForm },
  };
  return buildFinengineMemoPackage(dealId, rows, base, {
    signals: opts.signals,
    hardAnchors: opts.hardAnchors,
    industry: getIndustryProfile(naics),
  });
}

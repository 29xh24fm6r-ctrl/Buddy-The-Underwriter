import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isTrustedResolution } from "@/lib/financialReview/isTrustedFinancialResolution";

// Minimum confidence to consider a required fact "resolved enough" without banker confirmation.
// Only applies to REQUIRED_FACT_KEYS — secondary schedule facts routinely extract at 50%
// and should never surface as individual banker gaps.
export const CONFIDENCE_THRESHOLD = 0.75;

// Required fact keys that MUST be present AND banker-resolved for a deal to be complete.
// "Complete" means resolution_status is a trusted resolution (confirmed/overridden/provided)
// on all of these — not just extracted.
//
// SCOPE RULE: All gap categories (missing_fact, low_confidence, conflict) operate
// exclusively on these keys. Secondary facts (schedule line items, balance sheet components,
// etc.) are NOT surfaced as banker gaps regardless of their confidence level. The banker's
// job is to confirm the credit-critical facts, not to audit every extracted line item.
export const REQUIRED_FACT_KEYS = [
  "TOTAL_REVENUE",
  "NET_INCOME",
  "DEPRECIATION",
  "ANNUAL_DEBT_SERVICE",
  "DSCR",
] as const;

export type GapType =
  | "missing_fact"
  | "low_confidence"
  | "conflict";

export type GapItem = {
  gap_type: GapType;
  fact_type: string;
  fact_key: string;
  owner_entity_id: string | null;
  fact_id: string | null;
  conflict_id: string | null;
  description: string;
  resolution_prompt: string;
  priority: number;
};

export type RequiredFactRow = {
  id: string;
  fact_key: string;
  fact_value_num: number | string | null;
  confidence: number | null;
  resolution_status: string | null;
  created_at?: string | null;
};

/**
 * Pick the fact that represents each required key: a banker-resolved fact
 * wins outright, then the highest extraction confidence, then the newest.
 *
 * The previous implementation built `new Map(rows)` over rows ordered
 * created_at DESC — Map keeps the LAST entry per key, i.e. the OLDEST fact —
 * so a key that later gained a 95% extraction kept being judged on its first
 * 55% one and stayed a low-confidence gap forever.
 */
export function selectBestRequiredFacts(rows: RequiredFactRow[]): Map<string, RequiredFactRow> {
  const best = new Map<string, RequiredFactRow>();
  for (const row of rows) {
    if (row.fact_value_num == null) continue;
    const current = best.get(row.fact_key);
    if (!current) {
      best.set(row.fact_key, row);
      continue;
    }
    const trustedNow = isTrustedResolution(row.resolution_status);
    const trustedCur = isTrustedResolution(current.resolution_status);
    if (trustedNow !== trustedCur) {
      if (trustedNow) best.set(row.fact_key, row);
      continue;
    }
    const confNow = row.confidence ?? 0;
    const confCur = current.confidence ?? 0;
    if (confNow !== confCur) {
      if (confNow > confCur) best.set(row.fact_key, row);
      continue;
    }
    const tNow = row.created_at ? Date.parse(row.created_at) : 0;
    const tCur = current.created_at ? Date.parse(current.created_at) : 0;
    if (tNow > tCur) best.set(row.fact_key, row);
  }
  return best;
}

export type OpenGapRow = { id: string; fact_key: string; gap_type: string };

/**
 * Open queue rows that no longer correspond to a current gap, matched on
 * (fact_key, gap_type). Matching on fact_key alone (the previous behaviour)
 * let a stale `missing_fact` row survive indefinitely once the same key had
 * a `low_confidence` row — the exact state that blocked deal c0f6caab's
 * committee gate on 2026-09-08 with three "not extracted" items for facts
 * that had been on file for six days.
 */
export function selectResolvedGapIds(openRows: OpenGapRow[], currentGaps: Pick<GapItem, "fact_key" | "gap_type">[]): string[] {
  const live = new Set(currentGaps.map((g) => `${g.fact_key}::${g.gap_type}`));
  return openRows.filter((r) => !live.has(`${r.fact_key}::${r.gap_type}`)).map((r) => r.id);
}

/**
 * Computes the current gap state for a deal and upserts into deal_gap_queue.
 *
 * Gap categories in priority order (all scoped to REQUIRED_FACT_KEYS only):
 *   1. missing_fact (p90)        — required key has no extracted value at all
 *   2. conflict (p90)            — required key has conflicting values across documents
 *   3. low_confidence (p70)      — required key extracted below CONFIDENCE_THRESHOLD
 *
 * A deal is only truly complete when ALL required facts have a trusted resolution
 * (confirmed, overridden, or provided). Extracted facts are NOT the same as
 * banker-resolved facts. OCC SR 11-7 requirement.
 *
 * Safe to call repeatedly — upserts are idempotent.
 * Called after: document extraction, BIE run, transcript ingestion, manual confirmation.
 */
export async function computeDealGaps(args: {
  dealId: string;
  bankId: string;
}): Promise<{ ok: true; openGaps: number; resolved: number } | { ok: false; error: string }> {
  try {
    const sb = supabaseAdmin();
    const gaps: GapItem[] = [];

    // ── 1. Load all required facts (present or missing) ────────────────────
    // Scoped to REQUIRED_FACT_KEYS only. We never load secondary facts here.
    const { data: presentFacts, error: presentFactsError } = await sb
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num, confidence, id, resolution_status, created_at")
      .eq("deal_id", args.dealId)
      .eq("bank_id", args.bankId)
      .eq("is_superseded", false)
      .in("fact_key", REQUIRED_FACT_KEYS as unknown as string[])
      .not("fact_value_num", "is", null)
      .order("created_at", { ascending: false });
    if (presentFactsError) {
      // Fail closed: an empty read here would mark every required fact
      // "missing" and open five false gaps.
      return { ok: false, error: `required_facts_read_failed:${presentFactsError.message}` };
    }

    const presentMap = selectBestRequiredFacts((presentFacts ?? []) as RequiredFactRow[]);

    // ── 2. Missing required facts ───────────────────────────────────────────
    for (const key of REQUIRED_FACT_KEYS) {
      if (!presentMap.has(key)) {
        gaps.push({
          gap_type: "missing_fact",
          fact_type: "FINANCIAL",
          fact_key: key,
          owner_entity_id: null,
          fact_id: null,
          conflict_id: null,
          description: `Required metric "${key}" has not been extracted from any document.`,
          resolution_prompt: `Upload the financial document containing ${key} and re-run spreads, or provide it directly.`,
          priority: 90,
        });
      }
    }

    // ── 3. Conflicts on required facts only ────────────────────────────────
    const { data: conflicts } = await sb
      .from("deal_fact_conflicts")
      .select("id, fact_type, fact_key, conflicting_values, owner_entity_id")
      .eq("deal_id", args.dealId)
      .eq("bank_id", args.bankId)
      .eq("status", "open")
      .in("fact_key", REQUIRED_FACT_KEYS as unknown as string[]);

    for (const c of conflicts ?? []) {
      const vals = (c.conflicting_values as any[])
        .map((v: any) => `${v.source}: ${v.value}`)
        .join(" vs ");
      gaps.push({
        gap_type: "conflict",
        fact_type: c.fact_type,
        fact_key: c.fact_key,
        owner_entity_id: c.owner_entity_id ?? null,
        fact_id: null,
        conflict_id: c.id,
        description: `Conflicting values for "${c.fact_key}": ${vals}`,
        resolution_prompt: `I found two different values for ${c.fact_key}. Which is correct?`,
        priority: 90,
      });
    }

    // ── 4. Low-confidence REQUIRED facts only ──────────────────────────────
    //
    // We intentionally do NOT query all facts with low confidence — that would
    // surface every schedule line item extracted at 50% (expected behavior for
    // secondary facts) as a banker gap. Only the 5 required keys matter here.
    for (const [key, f] of presentMap.entries()) {
      const conf = f.confidence ?? 0;
      if (conf >= CONFIDENCE_THRESHOLD) continue;
      if (isTrustedResolution(f.resolution_status)) continue;
      if (f.resolution_status === "rejected") continue;

      const displayValue = f.fact_value_num != null
        ? Number(f.fact_value_num).toLocaleString("en-US", { maximumFractionDigits: 2 })
        : "unknown";

      gaps.push({
        gap_type: "low_confidence",
        fact_type: "FINANCIAL",
        fact_key: key,
        owner_entity_id: null,
        fact_id: f.id,
        conflict_id: null,
        description: `"${key}" was extracted as ${displayValue} with low confidence (${Math.round(conf * 100)}%). Banker verification required.`,
        resolution_prompt: `I extracted ${key} as ${displayValue} but with only ${Math.round(conf * 100)}% confidence. Can you confirm that's correct?`,
        priority: 70,
      });
    }

    // ── 5. High-confidence facts — auto-confirm ────────────────────────────
    //
    // Facts extracted with high confidence (>= CONFIDENCE_THRESHOLD) from
    // source-backed documents do not require blind banker confirmation.
    // They are treated as trustworthy unless a specific issue arises
    // (conflict, low confidence, missing support).
    //
    // Banker review is evidence-based: only low_confidence, conflict, and
    // missing_fact items surface in the review panel. High-confidence
    // extractions are accepted by the system and available for downstream
    // underwriting immediately.
    //
    // If a banker needs to override a high-confidence value, they do so
    // through the financials/spreads UI, not through a blind confirm queue.
    //
    // Previous behavior (needs_confirmation) was removed because it asked
    // bankers to approve numbers without evidence context — creating
    // busywork and audit risk.

    // ── 6. Sync gap queue ───────────────────────────────────────────────────
    // Resolve every open row that no longer matches a current (fact_key,
    // gap_type) gap, by id, and surface the write's error instead of
    // dropping it: a silently failed sync leaves the committee gate blocked
    // on items the evidence has already cleared.
    const { data: openRows, error: openRowsError } = await sb
      .from("deal_gap_queue")
      .select("id, fact_key, gap_type")
      .eq("deal_id", args.dealId)
      .eq("bank_id", args.bankId)
      .eq("status", "open");
    if (openRowsError) {
      return { ok: false, error: `gap_queue_read_failed:${openRowsError.message}` };
    }
    const resolvedIds = selectResolvedGapIds((openRows ?? []) as OpenGapRow[], gaps);
    if (resolvedIds.length > 0) {
      const { error: resolveError } = await sb
        .from("deal_gap_queue")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .in("id", resolvedIds);
      if (resolveError) {
        return { ok: false, error: `gap_queue_resolve_failed:${resolveError.message}` };
      }
    }

    for (const gap of gaps) {
      await sb
        .from("deal_gap_queue")
        .upsert(
          {
            deal_id: args.dealId,
            bank_id: args.bankId,
            ...gap,
            status: "open",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "deal_id,fact_type,fact_key,gap_type,status" },
        );
    }

    return { ok: true, openGaps: gaps.length, resolved: resolvedIds.length };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Minimum confidence to consider a fact "resolved enough" without banker confirmation
export const CONFIDENCE_THRESHOLD = 0.75;

// Required fact keys that MUST be present AND banker-confirmed for a deal to be complete.
// "Complete" means resolution_status = 'confirmed' on all of these — not just extracted.
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
  | "conflict"
  | "needs_confirmation";

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

/**
 * Computes the current gap state for a deal and upserts into deal_gap_queue.
 *
 * Gap categories in priority order:
 *   1. missing_fact (p90)   — required key has no extracted value at all
 *   2. conflict (p90)       — same key has conflicting values across documents
 *   3. low_confidence (p70) — extracted value confidence < CONFIDENCE_THRESHOLD
 *   4. needs_confirmation (p60) — present + confident but resolution_status != 'confirmed'
 *
 * A deal is only truly complete when ALL required facts have resolution_status = 'confirmed'.
 * Extracted facts are NOT the same as confirmed facts. This is a regulatory requirement.
 *
 * Called after every: document extraction, BIE run, transcript ingestion, manual confirmation.
 * Safe to call repeatedly — upserts are idempotent.
 */
export async function computeDealGaps(args: {
  dealId: string;
  bankId: string;
}): Promise<{ ok: true; openGaps: number } | { ok: false; error: string }> {
  try {
    const sb = supabaseAdmin();
    const gaps: GapItem[] = [];

    // ── 1. Load all required facts (present or missing) ────────────────────
    const { data: presentFacts } = await sb
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num, confidence, id, resolution_status")
      .eq("deal_id", args.dealId)
      .eq("bank_id", args.bankId)
      .eq("is_superseded", false)
      .in("fact_key", REQUIRED_FACT_KEYS as unknown as string[])
      .not("fact_value_num", "is", null)
      .order("created_at", { ascending: false });

    const presentMap = new Map(
      (presentFacts ?? []).map((f: any) => [f.fact_key, f])
    );

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

    // ── 3. Open conflicts ───────────────────────────────────────────────────
    const { data: conflicts } = await sb
      .from("deal_fact_conflicts")
      .select("id, fact_type, fact_key, conflicting_values, owner_entity_id")
      .eq("deal_id", args.dealId)
      .eq("bank_id", args.bankId)
      .eq("status", "open");

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

    // ── 4. Low-confidence facts ─────────────────────────────────────────────
    const { data: lowConfFacts } = await sb
      .from("deal_financial_facts")
      .select("id, fact_key, fact_type, confidence, fact_value_num, fact_value_text")
      .eq("deal_id", args.dealId)
      .eq("bank_id", args.bankId)
      .eq("is_superseded", false)
      .not("confidence", "is", null)
      .lt("confidence", CONFIDENCE_THRESHOLD)
      .neq("resolution_status", "confirmed")
      .neq("resolution_status", "rejected")
      .order("confidence", { ascending: true })
      .limit(20);

    for (const f of lowConfFacts ?? []) {
      gaps.push({
        gap_type: "low_confidence",
        fact_type: f.fact_type,
        fact_key: f.fact_key,
        owner_entity_id: null,
        fact_id: f.id,
        conflict_id: null,
        description: `"${f.fact_key}" was extracted with low confidence (${Math.round(f.confidence * 100)}%). Banker verification required.`,
        resolution_prompt: `Can you confirm the value for ${f.fact_key}? I extracted ${f.fact_value_num ?? f.fact_value_text} but I'm not fully certain.`,
        priority: 70,
      });
    }

    // ── 5. Needs confirmation — present + confident but not banker-confirmed ─
    //
    // This is the critical category that prevents the system from falsely
    // declaring a deal complete. Extracted facts are NOT confirmed facts.
    // A fact with confidence 0.95 still requires banker sign-off before it
    // can legally anchor a credit decision. This is an OCC SR 11-7 requirement.
    //
    // Only applies to REQUIRED_FACT_KEYS — we don't ask for confirmation on
    // every fact, only the ones that gate memo generation.
    for (const [key, f] of presentMap.entries()) {
      // Skip if already caught by low_confidence above
      if ((f.confidence ?? 0) < CONFIDENCE_THRESHOLD) continue;
      // Skip if already confirmed or deliberately rejected
      if (f.resolution_status === "confirmed") continue;
      if (f.resolution_status === "rejected") continue;

      const displayValue = f.fact_value_num != null
        ? Number(f.fact_value_num).toLocaleString("en-US", { maximumFractionDigits: 2 })
        : "unknown";

      gaps.push({
        gap_type: "needs_confirmation",
        fact_type: "FINANCIAL",
        fact_key: key,
        owner_entity_id: null,
        fact_id: f.id,
        conflict_id: null,
        description: `"${key}" was extracted as ${displayValue} but has not been confirmed by a banker.`,
        resolution_prompt: `I have ${key} as ${displayValue} from the financial documents. Can you confirm that's correct?`,
        priority: 60,
      });
    }

    // ── 6. Sync gap queue ───────────────────────────────────────────────────
    //
    // Resolve previously open gaps that are no longer in the current gap list.
    // This handles both cases:
    //   - gaps.length > 0: resolve gaps for keys not in current open set
    //   - gaps.length = 0: resolve ALL previously open gaps (deal truly complete)
    if (gaps.length > 0) {
      const openGapKeys = gaps.map(g => g.fact_key);
      await sb
        .from("deal_gap_queue")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("deal_id", args.dealId)
        .eq("bank_id", args.bankId)
        .eq("status", "open")
        .not("fact_key", "in", `(${openGapKeys.map(k => `"${k}"`).join(",")})`);
    } else {
      // No gaps — resolve everything. Deal is genuinely complete.
      await sb
        .from("deal_gap_queue")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("deal_id", args.dealId)
        .eq("bank_id", args.bankId)
        .eq("status", "open");
    }

    // Upsert current open gaps
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

    return { ok: true, openGaps: gaps.length };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

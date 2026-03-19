import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Minimum confidence to consider a fact "resolved enough" without confirmation
export const CONFIDENCE_THRESHOLD = 0.75;

// Required fact keys that MUST be present for memo to be complete
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
 * Called after every extraction, BIE run, or manual confirmation.
 * Returns the number of open gaps.
 */
export async function computeDealGaps(args: {
  dealId: string;
  bankId: string;
}): Promise<{ ok: true; openGaps: number } | { ok: false; error: string }> {
  try {
    const sb = supabaseAdmin();
    const gaps: GapItem[] = [];

    // ── 1. Check required facts exist ──────────────────────────────────
    const { data: presentFacts } = await sb
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num, confidence, id, resolution_status")
      .eq("deal_id", args.dealId)
      .eq("bank_id", args.bankId)
      .eq("is_superseded", false)
      .in("fact_key", REQUIRED_FACT_KEYS as unknown as string[])
      .not("fact_value_num", "is", null)
      .order("created_at", { ascending: false });

    const presentKeys = new Set((presentFacts ?? []).map((f: any) => f.fact_key));

    for (const key of REQUIRED_FACT_KEYS) {
      if (!presentKeys.has(key)) {
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

    // ── 2. Check low-confidence facts ──────────────────────────────────
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
        description: `"${f.fact_key}" was extracted with low confidence (${Math.round(f.confidence * 100)}%). Verification recommended.`,
        resolution_prompt: `Can you confirm the value for ${f.fact_key}? I extracted ${f.fact_value_num ?? f.fact_value_text} but I'm not fully certain.`,
        priority: 70,
      });
    }

    // ── 3. Check open conflicts ─────────────────────────────────────────
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

    // ── 4. Upsert gaps into deal_gap_queue ─────────────────────────────
    // First, resolve any previously open gaps for keys that are now resolved
    const openGapKeys = gaps.map(g => g.fact_key);
    if (openGapKeys.length > 0) {
      await sb
        .from("deal_gap_queue")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("deal_id", args.dealId)
        .eq("bank_id", args.bankId)
        .eq("status", "open")
        .not("fact_key", "in", `(${openGapKeys.map(k => `"${k}"`).join(",")})`);
    }

    // Upsert new gaps
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

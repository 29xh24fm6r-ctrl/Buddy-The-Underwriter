/**
 * Build Flag Engine Input — shared helper for assembling FlagEngineInput from DB.
 *
 * Used by both persistFlagReport.ts and rerunDocumentFlags.ts — never duplicated.
 *
 * Server-only — queries Supabase directly.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FlagEngineInput } from "./types";
import type { ResearchInference } from "@/lib/research/types";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function buildFlagEngineInput(dealId: string): Promise<FlagEngineInput> {
  const sb = supabaseAdmin();

  // 1. Load all canonical facts → flat Record + years_available
  const { canonical_facts, years_available } = await loadCanonicalFacts(sb, dealId);

  // 2. Load ratios from latest snapshot (truth_json) or derive from facts
  const ratios = await loadRatios(sb, dealId, canonical_facts);

  // 3. Deal type (optional — not on deals table, inferred from facts if available)
  const deal_type = await loadDealType(sb, dealId);

  // 4. Load research inferences (optional)
  const research_inferences = await loadResearchInferences(sb, dealId);

  // QoE and trend reports have no dedicated tables yet — pass undefined
  return {
    deal_id: dealId,
    canonical_facts,
    ratios,
    years_available,
    deal_type: deal_type ?? undefined,
    research_inferences: research_inferences.length > 0 ? research_inferences : undefined,
    // qoe_report: undefined — no DB table
    // trend_report: undefined — no DB table
  };
}

// ---------------------------------------------------------------------------
// Fact loader
// ---------------------------------------------------------------------------

type FactRow = {
  fact_key: string;
  fact_value_num: number | null;
  fact_value_text: string | null;
  fact_period_end: string | null;
};

async function loadCanonicalFacts(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<{ canonical_facts: Record<string, unknown>; years_available: number[] }> {
  try {
    const { data, error } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num, fact_value_text, fact_period_end")
      .eq("deal_id", dealId)
      .eq("is_superseded", false)
      .neq("resolution_status", "rejected");

    if (error || !data) {
      console.warn("[buildFlagEngineInput] facts query failed", { dealId, error: error?.message });
      return { canonical_facts: {}, years_available: [] };
    }

    const facts: Record<string, unknown> = {};
    const yearsSet = new Set<number>();

    for (const row of data as FactRow[]) {
      const value = row.fact_value_num ?? row.fact_value_text ?? null;

      if (row.fact_period_end) {
        const year = new Date(row.fact_period_end).getFullYear();
        if (year >= 2000 && year <= 2100) {
          yearsSet.add(year);
          // Year-keyed entry — primary lookup path in normalizedSpreadBuilder
          // getValueForYear() tries "GROSS_RECEIPTS_2023" before "GROSS_RECEIPTS"
          facts[`${row.fact_key}_${year}`] = value;
        }
      }

      // Generic key — fallback, last writer wins (typically most recent year)
      facts[row.fact_key] = value;
    }

    const years_available = Array.from(yearsSet).sort((a, b) => a - b);
    return { canonical_facts: facts, years_available };
  } catch (err: any) {
    console.warn("[buildFlagEngineInput] facts load failed", { dealId, error: err?.message });
    return { canonical_facts: {}, years_available: [] };
  }
}

// ---------------------------------------------------------------------------
// Ratio loader — from latest truth snapshot or facts directly
// ---------------------------------------------------------------------------

async function loadRatios(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  facts: Record<string, unknown>,
): Promise<Record<string, number | null>> {
  const ratios: Record<string, number | null> = {};

  // Try loading from latest truth snapshot first
  try {
    const { data } = await (sb as any)
      .from("deal_truth_snapshots")
      .select("truth_json")
      .eq("deal_id", dealId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data?.truth_json && typeof data.truth_json === "object") {
      // Extract ratio-like values from truth_json
      const truth = data.truth_json as Record<string, unknown>;
      for (const [key, val] of Object.entries(truth)) {
        if (typeof val === "number") {
          ratios[key] = val;
        }
      }
    }
  } catch (err: any) {
    console.warn("[buildFlagEngineInput] truth snapshot load failed (non-fatal)", {
      dealId,
      error: err?.message,
    });
  }

  // Also populate ratios from canonical facts for common ratio keys
  const RATIO_FACT_KEYS = [
    "DSCR", "FCCR", "CURRENT_RATIO", "DEBT_TO_EQUITY", "DEBT_EBITDA",
    "DSO", "DIO", "DPO", "CCC", "LTV", "GROSS_MARGIN", "NET_MARGIN",
    "EBITDA_MARGIN", "RETURN_ON_ASSETS", "RETURN_ON_EQUITY",
    "WORKING_CAPITAL", "CASH_RATIO", "QUICK_RATIO",
  ];
  for (const key of RATIO_FACT_KEYS) {
    if (ratios[key] == null && facts[key] != null && typeof facts[key] === "number") {
      ratios[key] = facts[key] as number;
    }
  }

  return ratios;
}

// ---------------------------------------------------------------------------
// Deal type loader — inferred from bank_policy_defaults or deal metadata
// ---------------------------------------------------------------------------

async function loadDealType(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<string | null> {
  try {
    // Check if deal has entity_type or any type-like metadata
    const { data } = await (sb as any)
      .from("deals")
      .select("entity_type")
      .eq("id", dealId)
      .maybeSingle();

    return data?.entity_type ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Research inferences loader
// ---------------------------------------------------------------------------

async function loadResearchInferences(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<ResearchInference[]> {
  try {
    // Get all completed mission IDs for this deal
    const { data: missions } = await (sb as any)
      .from("buddy_research_missions")
      .select("id")
      .eq("deal_id", dealId)
      .eq("status", "complete");

    const missionIds = (missions ?? []).map((m: any) => m.id as string);
    if (missionIds.length === 0) return [];

    const { data: inferences } = await (sb as any)
      .from("buddy_research_inferences")
      .select("id, mission_id, inference_type, conclusion, input_fact_ids, confidence, reasoning, created_at")
      .in("mission_id", missionIds);

    return (inferences ?? []) as ResearchInference[];
  } catch (err: any) {
    console.warn("[buildFlagEngineInput] research inferences load failed (non-fatal)", {
      dealId,
      error: err?.message,
    });
    return [];
  }
}

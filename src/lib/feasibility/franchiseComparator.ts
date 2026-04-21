import "server-only";

// src/lib/feasibility/franchiseComparator.ts
// Phase God Tier Feasibility — Franchise Comparator (step 8/16).
// Placeholder: the franchise intelligence DB (franchise_brands table + FDD
// Item 7/19/20 extracts) is not yet operational. This module defines the
// interface the orchestrator expects and returns null gracefully until
// the underlying tables exist. When they do, this is where the comparison
// query lives.

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ComparativeAnalysisResult } from "./types";

/**
 * Compare the proposed franchise concept against alternatives that fit the
 * same borrower profile and location. Uses the franchise intelligence DB
 * (franchise_brands etc.). If the DB is not yet operational, returns null
 * — this is the documented graceful-degradation path the orchestrator
 * relies on.
 */
export async function runFranchiseComparison(params: {
  proposedBrandId: string | null;
  proposedBrandName: string | null;
  naicsCode: string | null;
  borrowerEquity: number;
  borrowerExperienceYears: number;
  tradeAreaPopulation: number | null;
  tradeAreaMedianIncome: number | null;
}): Promise<ComparativeAnalysisResult | null> {
  // Silence unused-args warning while the implementation is a placeholder.
  void params;

  const sb = supabaseAdmin();

  // Detect whether the franchise intelligence tables exist yet. We ask the
  // catalog directly via a best-effort query and gracefully return null on
  // any error (missing table, RLS, schema mismatch).
  try {
    const { data, error } = await sb
      .rpc("buddy_table_exists" as never, {
        p_table_name: "franchise_brands",
      } as never)
      .maybeSingle();
    // If the helper RPC doesn't exist yet (likely on v1), just assume false
    // and return null — no franchise DB to query against.
    if (error) return null;
    const exists = (data as { exists?: boolean } | null)?.exists ?? false;
    if (!exists) return null;
  } catch {
    return null;
  }

  // TODO: Implement once franchise_brands / franchise_fdd_items tables land.
  // Query shape:
  //   1. SELECT brand rows in the same or adjacent NAICS code as the proposed one
  //   2. Filter by initial_investment_low <= borrowerEquity * 5 (80% LTV max)
  //   3. Filter by sba_certified = true
  //   4. Score each brand in this location using the same 4 dimensions and
  //      return the proposed brand + top 3 alternatives
  return null;
}

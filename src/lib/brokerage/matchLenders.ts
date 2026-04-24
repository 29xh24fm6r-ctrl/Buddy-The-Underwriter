import "server-only";

/**
 * Sprint 5 matching engine.
 *
 * Filters lender_programs against the deal's score, state, and NAICS.
 * Pre-Sprint-4, no lenders are provisioned → returns zero matches with
 * an explanatory reason. That's correct behavior, not a bug.
 *
 * Sprint 4 adds an LMA-active join; Sprint 5 explicitly does NOT.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type MatchResult = {
  matched: string[];
  matchCount: number;
  noMatchReasons?: string[];
};

export async function matchLendersToDeal(args: {
  dealId: string;
  sb: SupabaseClient;
}): Promise<MatchResult> {
  const { dealId, sb } = args;

  const [dealRes, scoreRes, appRes] = await Promise.all([
    sb
      .from("deals")
      .select("id, deal_type, loan_amount, state")
      .eq("id", dealId)
      .single(),
    sb
      .from("buddy_sba_scores")
      .select("score, band")
      .eq("deal_id", dealId)
      .eq("score_status", "locked")
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("borrower_applications")
      .select("naics")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!dealRes.data || !scoreRes.data) {
    return {
      matched: [],
      matchCount: 0,
      noMatchReasons: ["deal or score not ready"],
    };
  }

  const deal = dealRes.data as any;
  const score = scoreRes.data as any;
  const naics = (appRes.data as any)?.naics ?? null;

  const { data: programs } = await sb
    .from("lender_programs")
    .select(
      "bank_id, min_dscr, max_ltv, asset_types, geography, sba_only, score_threshold, notes",
    );

  if (!programs || programs.length === 0) {
    return {
      matched: [],
      matchCount: 0,
      noMatchReasons: [
        "no lender programs provisioned yet (expected pre-Sprint-4)",
      ],
    };
  }

  const matched = programs.filter((p: any) => {
    if (p.score_threshold != null && score.score < Number(p.score_threshold))
      return false;
    if (p.sba_only === true && deal.deal_type !== "SBA") return false;
    if (Array.isArray(p.geography) && p.geography.length > 0) {
      if (!p.geography.includes(deal.state) && !p.geography.includes("ALL"))
        return false;
    }
    if (Array.isArray(p.asset_types) && p.asset_types.length > 0 && naics) {
      const naicsPrefix = String(naics).slice(0, 2);
      if (
        !p.asset_types.some(
          (t: string) => naicsPrefix.startsWith(t.slice(0, 2)) || t === "ALL",
        )
      ) {
        return false;
      }
    }
    return true;
  });

  const bankIds = Array.from(new Set(matched.map((p: any) => p.bank_id))).slice(
    0,
    10,
  );

  return {
    matched: bankIds,
    matchCount: bankIds.length,
    noMatchReasons:
      bankIds.length === 0
        ? [`no lenders match score=${score.score} state=${deal.state}`]
        : undefined,
  };
}

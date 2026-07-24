import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "./types";

/**
 * Lender performance intelligence — spec section 7.3.
 *
 * There is no per-lender submission/decision entity in the schema today
 * (a deal carries a single brokerage_stage, not one outcome per lender it
 * was pitched to) — confirmed during discovery. Timing and outcome
 * metrics are derived from deal_brokerage_stage_transitions (PR3's
 * generic transition log, which already carries free-text reasons for
 * declined/lost transitions) joined to deals assigned to this lender via
 * brokerage_closing_workflows / brokerage_funding_verifications.
 * lender_programs.lender_name is free text, not FK'd to banks.id, so
 * appetite/product fields are joined by best-effort name match and are
 * left null (not fabricated) when no match exists — per the spec's "do
 * not create unsupported lender-policy facts."
 */

export type LenderPerformance = {
  lenderBankId: string;
  lenderName: string | null;
  activeSubmissions: number;
  termSheetRate: number | null;
  approvalRate: number | null;
  fundingRate: number | null;
  avgResponseTimeDays: number | null; // submitted -> term_sheet or declined
  avgCloseTimeDays: number | null; // commitment -> funded
  declineReasons: string[];
  lastContactAt: string | null;
  relationshipOwner: string | null;
  appetite: {
    minDscr: number | null;
    maxLtv: number | null;
    assetTypes: string[] | null;
    geography: string[] | null;
    sbaOnly: boolean | null;
    referralFeeBps: number | null;
    acceptsSba7a: boolean | null;
    agreementStatus: string | null;
  } | null;
};

const ACTIVE_SUBMISSION_STAGES = new Set(["submitted", "lender_review", "term_sheet", "underwriting"]);

export async function computeLenderPerformance(bankId: string, lenderBankId: string, sb: SB = supabaseAdmin()): Promise<LenderPerformance> {
  const { data: lenderBank } = await sb.from("banks").select("name").eq("id", lenderBankId).maybeSingle();
  const lenderName = (lenderBank as { name: string } | null)?.name ?? null;

  const { data: workflows } = await sb
    .from("brokerage_closing_workflows")
    .select("deal_id, status, opened_at, funded_at")
    .eq("lender_bank_id", lenderBankId);
  const wfRows = (workflows ?? []) as Array<{ deal_id: string; status: string | null; opened_at: string | null; funded_at: string | null }>;
  const dealIds = Array.from(new Set(wfRows.map((w) => w.deal_id)));

  const closeDurations = wfRows
    .filter((w) => w.opened_at && w.funded_at)
    .map((w) => (new Date(w.funded_at as string).getTime() - new Date(w.opened_at as string).getTime()) / (24 * 3600 * 1000));
  const avgCloseTimeDays = closeDurations.length > 0 ? Math.round(closeDurations.reduce((a, b) => a + b, 0) / closeDurations.length) : null;

  let activeSubmissions = 0;
  let termSheetRate: number | null = null;
  let approvalRate: number | null = null;
  let fundingRate: number | null = null;
  let avgResponseTimeDays: number | null = null;
  const declineReasons: string[] = [];

  if (dealIds.length > 0) {
    const { data: dealsData } = await sb.from("deals").select("id, brokerage_stage").eq("bank_id", bankId).in("id", dealIds);
    const deals = (dealsData ?? []) as Array<{ id: string; brokerage_stage: string | null }>;
    activeSubmissions = deals.filter((d) => d.brokerage_stage && ACTIVE_SUBMISSION_STAGES.has(d.brokerage_stage)).length;

    const submittedCount = dealIds.length;
    const { data: transitions } = await sb
      .from("deal_brokerage_stage_transitions")
      .select("deal_id, from_stage, to_stage, reason, created_at")
      .eq("bank_id", bankId)
      .in("deal_id", dealIds);
    const trs = (transitions ?? []) as Array<{ deal_id: string; from_stage: string | null; to_stage: string | null; reason: string | null; created_at: string }>;

    const reachedTermSheet = new Set(trs.filter((t) => t.to_stage === "term_sheet").map((t) => t.deal_id));
    const reachedCommitment = new Set(trs.filter((t) => t.to_stage === "commitment").map((t) => t.deal_id));
    const reachedFunded = new Set(trs.filter((t) => t.to_stage === "funded").map((t) => t.deal_id));
    termSheetRate = submittedCount > 0 ? reachedTermSheet.size / submittedCount : null;
    approvalRate = submittedCount > 0 ? reachedCommitment.size / submittedCount : null;
    fundingRate = submittedCount > 0 ? reachedFunded.size / submittedCount : null;

    const submittedAt = new Map<string, string>();
    for (const t of trs) if (t.to_stage === "submitted") submittedAt.set(t.deal_id, t.created_at);
    const responseDurations: number[] = [];
    for (const t of trs) {
      if ((t.to_stage === "term_sheet" || t.to_stage === "declined") && submittedAt.has(t.deal_id)) {
        const start = new Date(submittedAt.get(t.deal_id) as string).getTime();
        responseDurations.push((new Date(t.created_at).getTime() - start) / (24 * 3600 * 1000));
      }
      if (t.to_stage === "declined" && t.reason) declineReasons.push(t.reason);
    }
    avgResponseTimeDays = responseDurations.length > 0 ? Math.round(responseDurations.reduce((a, b) => a + b, 0) / responseDurations.length) : null;
  }

  const { data: agreement } = await sb
    .from("lender_marketplace_agreements")
    .select("referral_fee_bps, accepts_sba_7a, status")
    .eq("lender_bank_id", lenderBankId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const agr = agreement as { referral_fee_bps: number | null; accepts_sba_7a: boolean | null; status: string | null } | null;

  type ProgramRow = { min_dscr: number | null; max_ltv: number | null; asset_types: string[] | null; geography: string[] | null; sba_only: boolean | null };
  let program: ProgramRow | null = null;
  if (lenderName) {
    const { data: programMatch } = await sb
      .from("lender_programs")
      .select("min_dscr, max_ltv, asset_types, geography, sba_only")
      .eq("bank_id", bankId)
      .ilike("lender_name", lenderName)
      .limit(1)
      .maybeSingle();
    program = (programMatch as ProgramRow | null) ?? null;
  }

  const appetite =
    program || agr
      ? {
          minDscr: program?.min_dscr ?? null,
          maxLtv: program?.max_ltv ?? null,
          assetTypes: program?.asset_types ?? null,
          geography: program?.geography ?? null,
          sbaOnly: program?.sba_only ?? null,
          referralFeeBps: agr?.referral_fee_bps ?? null,
          acceptsSba7a: agr?.accepts_sba_7a ?? null,
          agreementStatus: agr?.status ?? null,
        }
      : null;

  // lastContactAt / relationshipOwner intentionally null: there is no FK
  // linking a lender's banks.id to a crm_organizations row representing
  // that same lender for contact-activity purposes, so crm_activities
  // cannot be reliably joined here. Left null rather than guessed at by
  // name match, unlike the lower-stakes lender_programs appetite lookup
  // above (which only enriches optional descriptive fields, not a
  // person's identity).
  return {
    lenderBankId,
    lenderName,
    activeSubmissions,
    termSheetRate,
    approvalRate,
    fundingRate,
    avgResponseTimeDays,
    avgCloseTimeDays,
    declineReasons,
    lastContactAt: null,
    relationshipOwner: null,
    appetite,
  };
}

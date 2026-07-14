import { detectSBAProgram } from "@/lib/sba/sbaGuarantee";
import { verifyEquitySeasoning } from "@/lib/sba/equitySeasoning";

/**
 * Deal data builder — derives the flat field record the S1 SOP 50 10 8
 * rules (sba_policy_rules.condition_json) reference by name. Without this,
 * every new rule evaluates against `undefined` and fails closed silently.
 *
 * Principle #16 (SPEC S2): when a field can't yet be derived from canonical
 * state, it is explicitly `null` — never a fabricated default. The
 * eligibility engine treats null as "not yet available" and the rule fails
 * closed, surfacing in the Story tab / deal_gap_queue.
 *
 * Sequential queries only — no Supabase join syntax without a confirmed FK
 * (existing roadmap rule; also lets each query degrade independently when a
 * table/row is missing rather than nulling the whole result).
 *
 * Takes an injected Supabase-like client (real supabaseAdmin() in
 * production, a lightweight in-memory fake in tests) rather than resolving
 * one internally — mirrors compliancePackage.ts / complianceEnforcement.ts.
 * Keeps this module free of "server-only", which the plain `node --test`
 * harness (no react-server condition) can't tolerate transitively.
 */

export type DealDataBuilderClient = { from: (table: string) => any };

export type SbaEligibilityInputFields = {
  // Loan / program
  loan_amount: number | null;
  is_7a_small_loan: boolean | null;
  is_acquisition: boolean | null;
  dscr: number | null;

  // Equity / sources
  equity_injection_pct_of_project: number | null;
  sources_uses_imbalance_abs: number | null;
  seller_note_used_for_equity: boolean | null;
  seller_note_full_standby_for_loan_term: boolean | null;
  seller_note_pct_of_equity: number | null;
  equity_seasoning_verified: boolean | null;

  // Use of proceeds
  working_capital_pct_of_proceeds: number | null;
  working_capital_justification_present: boolean | null;
  lien_on_all_fixed_assets_planned: boolean | null;
  use_of_proceeds_includes_mca_refi: boolean | null;
  use_of_proceeds_category: string | null;

  // Citizenship / lookback
  all_owners_citizenship_eligible: boolean | null;
  ineligible_owner_in_lookback_window: boolean | null;

  // Federal screens (S4)
  caivrs_checked: boolean | null;
  caivrs_hits: number | null;
  borrower_has_prior_sba_loss: boolean | null;

  // Documentation (S3/S4)
  form_4506c_signed: boolean | null;
  tax_transcripts_received_or_pending: boolean | null;

  // Lender screens
  lender_is_federally_regulated: boolean | null;
  screening_uses_sbss: boolean;

  // Credit elsewhere
  credit_elsewhere_test_documented: boolean | null;
  credit_elsewhere_finding: string | null;

  // Change of ownership
  retaining_seller_present: boolean | null;
  retaining_seller_guarantees_2yr: boolean | null;
  cob_is_single_transaction: boolean | null;
  is_partial_cob: boolean | null;
  cob_transaction_type: string | null;

  // Franchise
  is_franchise_deal: boolean;
  franchise_brand_on_directory: boolean | null;
  franchise_brand_certified_or_pre_deadline: boolean | null;

  // Insurance
  hazard_insurance_replacement_cost_present: boolean | null;
  is_single_owner_business: boolean | null;
  loan_fully_secured_by_hard_collateral: boolean | null;
  loan_fully_secured_by_business_assets: boolean | null;
  key_person_life_insurance_present: boolean | null;

  // Collateral
  personal_re_collateral_decision_documented: boolean | null;

  // Business
  business_age_years: number | null;
  employee_count: number | null;
  has_personal_guarantee: boolean | null;
  owner_percentage: number | null;

  // 504-specific
  creates_or_retains_jobs: boolean | null;
  meets_public_policy_goal: boolean | null;
  owner_occupancy_percentage: number | null;
};

// SBA Procedural Notice 5000-876626 (eff. 2026-03-01) rescinded the prior
// notice that allowed lawful permanent residents and made LPRs categorically
// ineligible to own any part of an SBA 7(a)/504 applicant — confirmed during
// SPEC-BROKERAGE-SBA-READY-V1 Ticket 0 (see
// docs/archive/brokerage-sba-ready-v1/T0-findings.md, item 2).
// "lawful_permanent_resident" remains a valid citizenship_status *value* to
// record (forms still need to state it truthfully) — it is just no longer a
// valid *eligibility* answer.
const ELIGIBLE_CITIZENSHIP_STATUSES = new Set([
  "us_citizen",
  "us_national",
]);

const FRANCHISE_CERTIFICATION_GRACE_DEADLINE = new Date("2026-06-30T23:59:59Z");

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function isIndividual(entityType: string | null | undefined): boolean {
  return entityType === "individual" || entityType === "person";
}

type UseOfProceedsLine = { category?: string | null; description?: string | null; amount?: number | null };

function parseUseOfProceeds(raw: unknown): UseOfProceedsLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is UseOfProceedsLine => typeof r === "object" && r !== null)
    .map((r) => ({
      category: typeof r.category === "string" ? r.category : null,
      description: typeof r.description === "string" ? r.description : null,
      amount: toNum(r.amount),
    }));
}

const WORKING_CAPITAL_PATTERN = /working[\s_-]*capital|^wc$/i;
const MCA_PATTERN = /\bmca\b|merchant\s*cash\s*advance/i;

export async function buildSbaEligibilityInput(
  dealId: string,
  sb: DealDataBuilderClient,
): Promise<SbaEligibilityInputFields> {
  const { data: deal } = await sb
    .from("deals")
    .select("id, deal_type, entity_type, loan_amount, borrower_id, bank_id")
    .eq("id", dealId)
    .maybeSingle();

  const { data: loanRequest } = await sb
    .from("deal_loan_requests")
    .select(
      "requested_amount, purpose, loan_purpose, purpose_category, use_of_proceeds, " +
        "seller_note_equity_portion, seller_note_full_standby, working_capital_justification, " +
        "lien_on_all_fixed_assets, franchise_brand_id, equity_injection_amount, total_project_cost, " +
        "injection_amount, occupancy_type, occupancy_percentage, creates_or_retains_jobs, meets_public_policy_goal",
    )
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: ownershipEntities } = await sb
    .from("ownership_entities")
    .select("entity_type, citizenship_status, ownership_pct")
    .eq("deal_id", dealId);

  const { data: bankAccounts } = await sb
    .from("borrower_bank_accounts")
    .select("id, current_balance")
    .eq("deal_id", dealId);

  const { data: bankTransactions } = await sb
    .from("borrower_bank_transactions")
    .select("posted_date, amount, merchant_name, description")
    .eq("deal_id", dealId);

  const { data: snapshotRow } = await sb
    .from("financial_snapshots")
    .select("snapshot_json")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: dealFranchise } = await sb
    .from("deal_franchises")
    .select("brand_id")
    .eq("deal_id", dealId)
    .maybeSingle();

  // ---- Federal screens (S4) --------------------------------------------
  const { data: caivrsChecks } = await sb
    .from("borrower_caivrs_checks")
    .select("hit_count, hit_details")
    .eq("deal_id", dealId);

  const { data: signed4506c } = await sb
    .from("signed_documents")
    .select("id")
    .eq("deal_id", dealId)
    .eq("form_code", "FORM_4506C")
    .limit(1)
    .maybeSingle();

  const { data: irsTranscriptRequests } = await sb
    .from("borrower_irs_transcript_requests")
    .select("status")
    .eq("deal_id", dealId);

  const franchiseBrandId =
    (dealFranchise as { brand_id?: string } | null)?.brand_id ??
    (loanRequest as { franchise_brand_id?: string } | null)?.franchise_brand_id ??
    null;

  type FranchiseBrandRow = { sba_directory_id: string | null; sba_certification_status: string | null };
  let franchiseBrand: FranchiseBrandRow | null = null;
  if (franchiseBrandId) {
    const { data } = await sb
      .from("franchise_brands")
      .select("sba_directory_id, sba_certification_status")
      .eq("id", franchiseBrandId)
      .maybeSingle();
    franchiseBrand = data as FranchiseBrandRow | null;
  }

  // ---- Loan / program -----------------------------------------------
  const loanAmount =
    toNum((loanRequest as { requested_amount?: number } | null)?.requested_amount) ??
    toNum((deal as { loan_amount?: number } | null)?.loan_amount);
  const program = detectSBAProgram((deal as { deal_type?: string | null } | null)?.deal_type ?? null);
  const is7aSmallLoan =
    loanAmount != null ? program === "sba_7a_standard" && loanAmount <= 350_000 : null;

  const purposeText = [
    (loanRequest as { purpose?: string } | null)?.purpose,
    (loanRequest as { loan_purpose?: string } | null)?.loan_purpose,
    (loanRequest as { purpose_category?: string } | null)?.purpose_category,
  ]
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase();
  const isAcquisition = purposeText
    ? /acquisition|change of ownership|\bcob\b|buy.?out|purchase of business/.test(purposeText)
    : null;

  const dscr = toNum(
    (snapshotRow as { snapshot_json?: { dscr?: { value_num?: number } } } | null)?.snapshot_json?.dscr
      ?.value_num,
  );

  // ---- Equity / sources -----------------------------------------------
  const equityInjectionAmount =
    toNum((loanRequest as { equity_injection_amount?: number } | null)?.equity_injection_amount) ??
    toNum((loanRequest as { injection_amount?: number } | null)?.injection_amount);
  const totalProjectCost = toNum((loanRequest as { total_project_cost?: number } | null)?.total_project_cost);
  const equityInjectionPctOfProject =
    equityInjectionAmount != null && totalProjectCost != null && totalProjectCost > 0
      ? equityInjectionAmount / totalProjectCost
      : null;

  const sourcesUsesImbalanceAbs =
    loanAmount != null && equityInjectionAmount != null && totalProjectCost != null
      ? Math.abs(loanAmount + equityInjectionAmount - totalProjectCost)
      : null;

  // SPEC S4 E-3: computed live from Plaid-synced accounts/transactions
  // (no separate persisted column) via the pure verifyEquitySeasoning() —
  // see equitySeasoningService.ts for the DB-writing sibling that also
  // emits deal_gap_queue rows on the post-Plaid-sync hook.
  const accountRows = (bankAccounts ?? []) as Array<{ id: string; current_balance: number | null }>;
  let equitySeasoningVerified: boolean | null = null;
  if (equityInjectionAmount != null && equityInjectionAmount > 0 && accountRows.length > 0) {
    const currentBalance = accountRows.reduce((sum, a) => sum + (a.current_balance ?? 0), 0);
    const seasoningResult = verifyEquitySeasoning({
      equityAmount: equityInjectionAmount,
      currentBalance,
      transactions: (bankTransactions ?? []) as Array<{ posted_date: string; amount: number; merchant_name?: string | null; description?: string | null }>,
    });
    equitySeasoningVerified = seasoningResult.seasoned;
  }

  const sellerNoteEquityPortion = toNum(
    (loanRequest as { seller_note_equity_portion?: number } | null)?.seller_note_equity_portion,
  );
  const sellerNoteUsedForEquity = sellerNoteEquityPortion != null ? sellerNoteEquityPortion > 0 : null;
  const sellerNoteFullStandby =
    (loanRequest as { seller_note_full_standby?: boolean } | null)?.seller_note_full_standby ?? null;
  const sellerNotePctOfEquity =
    sellerNoteEquityPortion != null && equityInjectionAmount != null && equityInjectionAmount > 0
      ? sellerNoteEquityPortion / equityInjectionAmount
      : null;

  // ---- Use of proceeds -----------------------------------------------
  const uopLines = parseUseOfProceeds((loanRequest as { use_of_proceeds?: unknown } | null)?.use_of_proceeds);
  const totalProceeds = uopLines.reduce((sum, l) => sum + (l.amount ?? 0), 0);
  const wcAmount = uopLines
    .filter((l) => (l.category && WORKING_CAPITAL_PATTERN.test(l.category)) || (l.description && WORKING_CAPITAL_PATTERN.test(l.description)))
    .reduce((sum, l) => sum + (l.amount ?? 0), 0);
  const workingCapitalPctOfProceeds = uopLines.length > 0 && totalProceeds > 0 ? wcAmount / totalProceeds : null;
  const workingCapitalJustificationPresent = uopLines.length > 0
    ? Boolean((loanRequest as { working_capital_justification?: string } | null)?.working_capital_justification?.trim())
    : null;
  const lienOnAllFixedAssetsPlanned =
    (loanRequest as { lien_on_all_fixed_assets?: boolean } | null)?.lien_on_all_fixed_assets ?? null;
  const useOfProceedsIncludesMcaRefi = uopLines.length > 0
    ? uopLines.some((l) => (l.category && MCA_PATTERN.test(l.category)) || (l.description && MCA_PATTERN.test(l.description)))
    : null;
  const useOfProceedsCategory = (loanRequest as { purpose_category?: string } | null)?.purpose_category ?? null;

  // ---- Citizenship / lookback -----------------------------------------
  const owners = (ownershipEntities ?? []) as Array<{
    entity_type: string | null;
    citizenship_status: string | null;
    ownership_pct: number | null;
  }>;
  const individualOwners = owners.filter((o) => isIndividual(o.entity_type));
  let allOwnersCitizenshipEligible: boolean | null = null;
  if (individualOwners.length > 0) {
    if (individualOwners.some((o) => !o.citizenship_status)) {
      allOwnersCitizenshipEligible = null;
    } else {
      allOwnersCitizenshipEligible = individualOwners.every(
        (o) => o.citizenship_status && ELIGIBLE_CITIZENSHIP_STATUSES.has(o.citizenship_status),
      );
    }
  }

  // ---- Franchise --------------------------------------------------------
  const isFranchiseDeal = Boolean(franchiseBrandId);
  const franchiseBrandOnDirectory = isFranchiseDeal
    ? Boolean(franchiseBrand?.sba_directory_id)
    : null;
  const franchiseBrandCertifiedOrPreDeadline = isFranchiseDeal
    ? new Date() < FRANCHISE_CERTIFICATION_GRACE_DEADLINE || franchiseBrand?.sba_certification_status === "certified"
    : null;

  // ---- Insurance / business ---------------------------------------------
  const totalOwners = owners.filter((o) => (o.ownership_pct ?? 0) > 0);
  const isSingleOwnerBusiness = totalOwners.length > 0 ? totalOwners.length === 1 : null;

  // ---- Federal screens (S4) ----------------------------------------------
  const caivrsRows = (caivrsChecks ?? []) as Array<{ hit_count: number | null; hit_details: unknown }>;
  const caivrsChecked = caivrsRows.length > 0;
  const caivrsHits = caivrsChecked ? caivrsRows.reduce((sum, r) => sum + (r.hit_count ?? 0), 0) : null;
  const borrowerHasPriorSbaLoss = caivrsChecked
    ? caivrsRows.some(
        (r) =>
          Array.isArray(r.hit_details) &&
          (r.hit_details as Array<Record<string, unknown>>).some(
            (h) => typeof h?.program === "string" && /sba/i.test(h.program as string),
          ),
      )
    : null;

  const form4506cSigned = Boolean(signed4506c);
  const irsRequestRows = (irsTranscriptRequests ?? []) as Array<{ status: string }>;
  const taxTranscriptsReceivedOrPending =
    irsRequestRows.length > 0
      ? irsRequestRows.some((r) => ["submitted", "received", "reconciled", "pending_signature"].includes(r.status))
      : null;

  return {
    loan_amount: loanAmount,
    is_7a_small_loan: is7aSmallLoan,
    is_acquisition: isAcquisition,
    dscr,

    equity_injection_pct_of_project: equityInjectionPctOfProject,
    sources_uses_imbalance_abs: sourcesUsesImbalanceAbs,
    seller_note_used_for_equity: sellerNoteUsedForEquity,
    seller_note_full_standby_for_loan_term: sellerNoteFullStandby,
    seller_note_pct_of_equity: sellerNotePctOfEquity,
    equity_seasoning_verified: equitySeasoningVerified,

    working_capital_pct_of_proceeds: workingCapitalPctOfProceeds,
    working_capital_justification_present: workingCapitalJustificationPresent,
    lien_on_all_fixed_assets_planned: lienOnAllFixedAssetsPlanned,
    use_of_proceeds_includes_mca_refi: useOfProceedsIncludesMcaRefi,
    use_of_proceeds_category: useOfProceedsCategory,

    all_owners_citizenship_eligible: allOwnersCitizenshipEligible,
    // No data source yet for prior-ownership lookback history — surfaced as
    // a gap, not guessed at.
    ineligible_owner_in_lookback_window: null,

    caivrs_checked: caivrsChecked,
    caivrs_hits: caivrsHits,
    borrower_has_prior_sba_loss: borrowerHasPriorSbaLoss,

    form_4506c_signed: form4506cSigned,
    tax_transcripts_received_or_pending: taxTranscriptsReceivedOrPending,

    // banks has no `settings` column in prod (verified via
    // information_schema during this build) — no source for this field yet.
    lender_is_federally_regulated: null,
    screening_uses_sbss: false,

    credit_elsewhere_test_documented: null,
    credit_elsewhere_finding: null,

    retaining_seller_present: null,
    retaining_seller_guarantees_2yr: null,
    cob_is_single_transaction: null,
    is_partial_cob: null,
    cob_transaction_type: null,

    is_franchise_deal: isFranchiseDeal,
    franchise_brand_on_directory: franchiseBrandOnDirectory,
    franchise_brand_certified_or_pre_deadline: franchiseBrandCertifiedOrPreDeadline,

    hazard_insurance_replacement_cost_present: null,
    is_single_owner_business: isSingleOwnerBusiness,
    loan_fully_secured_by_hard_collateral: null,
    loan_fully_secured_by_business_assets: null,
    key_person_life_insurance_present: null,

    personal_re_collateral_decision_documented: null,

    business_age_years: null,
    employee_count: null,
    has_personal_guarantee: null,
    owner_percentage: null,

    // ARC-00 Phase 4 (504 fields) — wired from the additive columns in
    // 20260711_a_deal_loan_requests_504_project_cost.sql.
    creates_or_retains_jobs: (loanRequest as { creates_or_retains_jobs?: boolean } | null)?.creates_or_retains_jobs ?? null,
    meets_public_policy_goal: (loanRequest as { meets_public_policy_goal?: boolean } | null)?.meets_public_policy_goal ?? null,
    owner_occupancy_percentage: toNum((loanRequest as { occupancy_percentage?: number } | null)?.occupancy_percentage),
  };
}

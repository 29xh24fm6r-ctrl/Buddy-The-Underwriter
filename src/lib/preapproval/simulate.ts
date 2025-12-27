/**
 * Pre-Approval Simulation Engine
 * 
 * Simulates loan viability WITHOUT committing deal truth.
 * Uses connected accounts + uploaded docs + manual inputs.
 * 
 * Flow:
 * 1. Read current deal state (uploads, connections, manual fields)
 * 2. Run agents in "dry-run" mode (or use existing findings)
 * 3. Normalize to claims
 * 4. Apply policy pack rules (SBA + Conventional)
 * 5. Generate outcomes + offer ranges + punchlist
 * 
 * Result: Borrower sees what they qualify for BEFORE applying.
 */

import type { SimMode, SimResult, SimOutcome, SimOffer, SimPunchlist } from "./types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SBA_PREAPPROVAL } from "@/lib/policy/packs/sba_preapproval";
import { CONVENTIONAL_PREAPPROVAL } from "@/lib/policy/packs/conventional_preapproval";
import { getSubstitutionSummary } from "@/lib/connect/substitutions";

/**
 * Run pre-approval simulation
 */
export async function simulatePreapproval(args: {
  dealId: string;
  bankId: string;
  mode: SimMode;
}): Promise<SimResult> {
  const { dealId, bankId, mode } = args;
  const sb = supabaseAdmin();

  // Step 1: Gather deal inputs
  const dealData = await gatherDealInputs(dealId, bankId);

  // Step 2: Check connected accounts boost
  const connectionSummary = await getSubstitutionSummary(dealId);

  // Step 3: Evaluate SBA viability
  const sbaOutcome = await evaluateSBAViability(dealData, connectionSummary);

  // Step 4: Evaluate Conventional viability
  const convOutcome = await evaluateConventionalViability(dealData, connectionSummary);

  // Step 5: Generate offer ranges
  const offers = await generateOfferRanges(dealData, sbaOutcome, convOutcome);

  // Step 6: Generate punchlist
  const punchlist = generatePunchlist(dealData, connectionSummary, sbaOutcome, convOutcome);

  // Step 7: Build simulated truth (not committed to DB)
  const truth = {
    mode,
    policy_packs: [SBA_PREAPPROVAL.id, CONVENTIONAL_PREAPPROVAL.id],
    deal_data: dealData,
    connection_summary: connectionSummary,
    simulated_at: new Date().toISOString(),
  };

  // Step 8: Calculate overall confidence
  const confidence = calculateOverallConfidence(dealData, connectionSummary, sbaOutcome, convOutcome);

  return {
    deal_id: dealId,
    mode,
    sba: sbaOutcome,
    conventional: convOutcome,
    offers,
    punchlist,
    truth,
    confidence,
  };
}

/**
 * Gather current deal inputs (uploads + connections + manual fields)
 */
async function gatherDealInputs(dealId: string, bankId: string) {
  const sb = supabaseAdmin();

  // Get deal record
  const { data: deal } = await sb
    .from("deals")
    .select("*")
    .eq("id", dealId)
    .single();

  // Get active connections
  const { data: connections } = await sb
    .from("borrower_account_connections")
    .select("connection_type, status, last_sync_at")
    .eq("deal_id", dealId)
    .eq("status", "active");

  // Get connected account data
  const { data: connectedData } = await sb
    .from("connected_account_data")
    .select("*")
    .eq("deal_id", dealId);

  // Get uploaded documents
  const { data: docs } = await sb
    .from("borrower_files")
    .select("id, file_type, doc_category, verification_status")
    .eq("deal_id", dealId);

  // Get owner information (for >=20% rule)
  const { data: owners } = await sb
    .from("deal_ownership")
    .select("*")
    .eq("deal_id", dealId)
    .gte("ownership_percentage", 20);

  return {
    deal: deal || {},
    connections: connections || [],
    connected_data: connectedData || [],
    documents: docs || [],
    owners: owners || [],
  };
}

/**
 * Evaluate SBA viability
 */
async function evaluateSBAViability(
  dealData: any,
  connectionSummary: any
): Promise<SimOutcome> {
  const reasons = [];
  let status: "pass" | "conditional" | "fail" = "conditional";

  // Check required fields
  const hasNaics = dealData.deal?.naics_code;
  const hasUseOfProceeds = dealData.deal?.use_of_proceeds;
  const hasRevenue = dealData.connected_data?.some((d: any) => d.data_category === "p_and_l") || 
                      dealData.documents?.some((d: any) => d.doc_category === "tax_return");

  if (!hasNaics) {
    reasons.push({
      code: "MISSING_NAICS",
      title: "NAICS code required",
      detail: "SBA requires a 6-digit NAICS code to check size standards.",
      source: "SBA" as const,
      confidence: 1.0,
    });
    status = "fail";
  }

  if (!hasUseOfProceeds) {
    reasons.push({
      code: "MISSING_USE_OF_PROCEEDS",
      title: "Use of proceeds needed",
      detail: "SBA requires clear documentation of how funds will be used.",
      source: "SBA" as const,
      confidence: 1.0,
    });
  }

  if (!hasRevenue) {
    reasons.push({
      code: "MISSING_FINANCIALS",
      title: "Financial data needed",
      detail: "Connect accounting system or upload tax returns to show repayment ability.",
      source: "SBA" as const,
      confidence: 0.9,
    });
  }

  // Check connections boost
  if (connectionSummary.total_boost > 0) {
    reasons.push({
      code: "CONNECTED_ACCOUNTS_BOOST",
      title: "Connected accounts strengthen application",
      detail: `You've connected ${connectionSummary.substitutions.length} data sources, saving ${connectionSummary.total_docs_saved} uploads.`,
      source: "SBA" as const,
      confidence: 0.95,
    });
  }

  // If no hard blockers, move to conditional
  if (status !== "fail" && hasNaics && hasUseOfProceeds) {
    status = hasRevenue ? "pass" : "conditional";
  }

  // Default message if passing
  if (status === "pass" && reasons.length === 0) {
    reasons.push({
      code: "SBA_VIABLE",
      title: "SBA 7(a) appears viable",
      detail: "Based on current data, you meet basic SBA eligibility. Final approval depends on full underwriting.",
      source: "SBA" as const,
      confidence: 0.75,
    });
  }

  return { status, reasons };
}

/**
 * Evaluate Conventional viability
 */
async function evaluateConventionalViability(
  dealData: any,
  connectionSummary: any
): Promise<SimOutcome> {
  const reasons = [];
  let status: "pass" | "conditional" | "fail" = "conditional";

  // Conventional typically requires more robust financials
  const hasFinancials = dealData.connected_data?.some((d: any) => 
    d.data_category === "p_and_l" || d.data_category === "balance_sheet"
  );

  const hasCreditInfo = dealData.deal?.credit_score || dealData.owners?.length > 0;

  if (!hasFinancials) {
    reasons.push({
      code: "MISSING_FINANCIALS_CONV",
      title: "Detailed financials required",
      detail: "Connect QuickBooks or upload P&L + Balance Sheet for conventional approval.",
      source: "BANK" as const,
      confidence: 0.95,
    });
    status = "conditional";
  }

  if (!hasCreditInfo) {
    reasons.push({
      code: "MISSING_CREDIT_INFO",
      title: "Credit information needed",
      detail: "Conventional loans require credit check on all owners ≥20%.",
      source: "BANK" as const,
      confidence: 0.9,
    });
  }

  // Check DSCR threshold (if we have financials)
  if (hasFinancials) {
    reasons.push({
      code: "DSCR_TARGET",
      title: "DSCR target: ≥1.15",
      detail: "Conventional loans typically require stronger cash flow than SBA (1.15 vs 1.10).",
      source: "BANK" as const,
      confidence: 0.85,
    });
  }

  // If data is strong, mark as pass
  if (hasFinancials && hasCreditInfo) {
    status = "pass";
    reasons.push({
      code: "CONV_VIABLE",
      title: "Conventional loan appears viable",
      detail: "You have sufficient data for conventional evaluation. Final approval depends on underwriting.",
      source: "BANK" as const,
      confidence: 0.7,
    });
  }

  return { status, reasons };
}

/**
 * Generate offer ranges based on viability
 */
async function generateOfferRanges(
  dealData: any,
  sbaOutcome: SimOutcome,
  convOutcome: SimOutcome
): Promise<SimOffer[]> {
  const offers: SimOffer[] = [];

  // SBA 7(a) offer (if viable)
  if (sbaOutcome.status === "pass" || sbaOutcome.status === "conditional") {
    offers.push({
      program: "SBA",
      product: "SBA 7(a) (Simulated)",
      amount_range: { 
        min: dealData.deal?.loan_amount ? Math.floor(dealData.deal.loan_amount * 0.5) : 50_000,
        max: dealData.deal?.loan_amount ? Math.ceil(dealData.deal.loan_amount * 1.2) : 500_000
      },
      term_months_range: { min: 60, max: 120 },
      rate_note: "Rate shown as placeholder. Final pricing depends on bank policy + full underwriting + SBA base rate.",
      constraints: [
        "Global DSCR target ≥ 1.10 (SBA guideline)",
        "Personal guarantee required for owners ≥20%",
        "SBA guarantee fee applies (typically 2-3.75%)"
      ],
      conditions: [
        sbaOutcome.status === "conditional" ? "Complete missing data (see punchlist)" : "Final underwriting approval",
        "Verify use of proceeds",
        "Confirm SBA eligibility (no ineligible activities)"
      ],
      confidence: sbaOutcome.status === "pass" ? 0.75 : 0.55,
    });
  }

  // SBA Express offer (if smaller amount)
  if (sbaOutcome.status === "pass" || sbaOutcome.status === "conditional") {
    const requestedAmount = dealData.deal?.loan_amount || 0;
    if (requestedAmount <= 500_000) {
      offers.push({
        program: "SBA",
        product: "SBA Express (Simulated)",
        amount_range: { 
          min: Math.max(50_000, Math.floor(requestedAmount * 0.5)),
          max: Math.min(500_000, requestedAmount)
        },
        term_months_range: { min: 36, max: 84 },
        rate_note: "Rate shown as placeholder. SBA Express typically has faster approval (5-7 days) but slightly higher rates.",
        constraints: [
          "Max loan amount: $500K",
          "SBA guarantee: 50% (lower than 7(a)'s 75-85%)",
          "Global DSCR target ≥ 1.10"
        ],
        conditions: [
          "Faster approval timeline (5-7 days vs 30-45 days)",
          "Personal guarantee required"
        ],
        confidence: sbaOutcome.status === "pass" ? 0.7 : 0.5,
      });
    }
  }

  // Conventional offer (if viable)
  if (convOutcome.status === "pass" || convOutcome.status === "conditional") {
    offers.push({
      program: "CONVENTIONAL",
      product: "Conventional Term Loan (Simulated)",
      amount_range: { 
        min: dealData.deal?.loan_amount ? Math.floor(dealData.deal.loan_amount * 0.6) : 100_000,
        max: dealData.deal?.loan_amount ? dealData.deal.loan_amount : 350_000
      },
      term_months_range: { min: 36, max: 84 },
      rate_note: "Rate shown as placeholder. Conventional rates vary based on creditworthiness, collateral, and bank policy.",
      constraints: [
        "Global DSCR target ≥ 1.15 (stricter than SBA)",
        "Credit score target ≥ 680",
        "Collateral required (real estate, equipment, or personal assets)",
        "Debt-to-equity ratio ≤ 3.5"
      ],
      conditions: [
        convOutcome.status === "conditional" ? "Complete missing data (see punchlist)" : "Final underwriting approval",
        "Provide collateral documentation",
        "Personal guarantee from owners ≥20%"
      ],
      confidence: convOutcome.status === "pass" ? 0.7 : 0.5,
    });
  }

  return offers;
}

/**
 * Generate punchlist of next actions
 */
function generatePunchlist(
  dealData: any,
  connectionSummary: any,
  sbaOutcome: SimOutcome,
  convOutcome: SimOutcome
): SimPunchlist {
  const borrowerActions: string[] = [];
  const bankerActions: string[] = [];
  const systemReviews: string[] = [];

  // Borrower actions based on missing data
  const hasPlaid = dealData.connections?.some((c: any) => c.connection_type === "plaid_bank");
  const hasQBO = dealData.connections?.some((c: any) => 
    c.connection_type === "quickbooks_online" || c.connection_type === "quickbooks_desktop"
  );
  const hasIRS = dealData.connections?.some((c: any) => c.connection_type === "irs_transcript");

  if (!hasPlaid) {
    borrowerActions.push("Connect bank accounts (12+ months history) — saves uploading 12 statements");
  }

  if (!hasQBO) {
    borrowerActions.push("Connect accounting system (QuickBooks/Xero) — saves uploading P&L + Balance Sheet");
  }

  if (!hasIRS) {
    borrowerActions.push("Connect IRS transcript or upload tax returns (3 years) — saves uploading 9 documents");
  }

  if (!dealData.deal?.use_of_proceeds) {
    borrowerActions.push("Describe how you'll use the loan funds (working capital, equipment, expansion, etc.)");
  }

  if (!dealData.owners || dealData.owners.length === 0) {
    borrowerActions.push("Provide ownership structure (who owns ≥20% of the business?)");
  }

  // Banker actions
  if (!dealData.deal?.naics_code) {
    bankerActions.push("Confirm 6-digit NAICS code with borrower");
  }

  if (!dealData.deal?.loan_amount) {
    bankerActions.push("Confirm requested loan amount + structure (term, rate expectations)");
  }

  bankerActions.push("Review connected account data + uploaded documents");
  bankerActions.push("Run credit check on owners ≥20%");

  // System reviews
  if (sbaOutcome.status === "conditional") {
    systemReviews.push("Re-run SBA eligibility once NAICS + use of proceeds confirmed");
  }

  if (convOutcome.status === "conditional") {
    systemReviews.push("Re-run conventional eligibility once financials + credit info available");
  }

  systemReviews.push("Calculate DSCR once cash flow data complete");

  return {
    borrower_actions: borrowerActions,
    banker_actions: bankerActions,
    system_reviews: systemReviews,
  };
}

/**
 * Calculate overall simulation confidence
 */
function calculateOverallConfidence(
  dealData: any,
  connectionSummary: any,
  sbaOutcome: SimOutcome,
  convOutcome: SimOutcome
): number {
  let confidence = 0.5; // Base confidence

  // Boost for connected accounts
  if (connectionSummary.total_boost >= 60) {
    confidence += 0.25; // Strong data from connections
  } else if (connectionSummary.total_boost >= 30) {
    confidence += 0.15;
  }

  // Boost for uploaded documents
  const docCount = dealData.documents?.length || 0;
  if (docCount >= 10) {
    confidence += 0.15;
  } else if (docCount >= 5) {
    confidence += 0.10;
  }

  // Reduce for missing critical data
  if (!dealData.deal?.naics_code) confidence -= 0.15;
  if (!dealData.deal?.use_of_proceeds) confidence -= 0.10;
  if (!dealData.owners || dealData.owners.length === 0) confidence -= 0.10;

  // Adjust based on outcomes
  if (sbaOutcome.status === "pass") confidence += 0.10;
  if (convOutcome.status === "pass") confidence += 0.10;

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, confidence));
}

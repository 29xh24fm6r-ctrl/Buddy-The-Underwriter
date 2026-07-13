import { isPhase1TriggerNaics } from "@/lib/sba/data/naicsAppendix6";

/**
 * SPEC S5 A-3 — pure trigger engine. No I/O; orchestrator.ts is the
 * DB-aware wrapper that persists these as `third_party_orders` rows.
 */

export type ThirdPartyOrderType =
  | "real_estate_appraisal"
  | "business_valuation"
  | "phase_1_environmental"
  | "phase_2_environmental"
  | "hazard_insurance"
  | "life_insurance"
  | "title_commitment"
  | "ucc_lien_search";

export interface ThirdPartyTriggerInput {
  dealId: string;
  loanAmount: number;
  loanProgram: string; // sba_7a_standard|sba_7a_express|sba_504|...
  isAcquisition: boolean;
  isSingleOwnerBusiness: boolean;
  loanFullySecuredByHardCollateral: boolean;
  realEstateInUseOfProceeds: boolean;
  businessNaics: string | null;
}

export interface ThirdPartyTriggerResult {
  order_type: ThirdPartyOrderType;
  trigger_reason: string;
  required: boolean;
  expected_completion_days: number;
}

export function evaluateThirdPartyTriggers(input: ThirdPartyTriggerInput): ThirdPartyTriggerResult[] {
  const out: ThirdPartyTriggerResult[] = [];

  if (input.realEstateInUseOfProceeds) {
    out.push({
      order_type: "real_estate_appraisal",
      trigger_reason: "Real estate in use of proceeds",
      required: true,
      expected_completion_days: 18,
    });
    out.push({
      order_type: "title_commitment",
      trigger_reason: "Real estate in use of proceeds",
      required: true,
      expected_completion_days: 14,
    });
  }

  if (input.isAcquisition && input.loanProgram === "sba_7a_standard") {
    out.push({
      order_type: "business_valuation",
      trigger_reason: "Acquisition deal under Standard 7(a)",
      required: true,
      expected_completion_days: 21,
    });
  }

  if (isPhase1TriggerNaics(input.businessNaics)) {
    out.push({
      order_type: "phase_1_environmental",
      trigger_reason: `NAICS ${input.businessNaics} on Appendix 6 list`,
      required: true,
      expected_completion_days: 28,
    });
  }

  if (input.loanAmount > 50_000) {
    out.push({
      order_type: "hazard_insurance",
      trigger_reason: "Loan amount > $50K",
      required: true,
      expected_completion_days: 5,
    });
  }

  if (input.loanAmount > 350_000 && input.isSingleOwnerBusiness && !input.loanFullySecuredByHardCollateral) {
    out.push({
      order_type: "life_insurance",
      trigger_reason: "Loan > $350K, single-owner, not fully secured",
      required: true,
      expected_completion_days: 10,
    });
  }

  // UCC lien search always required
  out.push({
    order_type: "ucc_lien_search",
    trigger_reason: "Required for all 7(a) loans",
    required: true,
    expected_completion_days: 3,
  });

  return out;
}

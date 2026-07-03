/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 11: SBA 7(a) / 504 Intelligence.
 *
 * Extends the native SBA eligibility engine (`sba/eligibility.ts`) with the full
 * intelligence layer: EPC/OC structure, standby-debt treatment, guarantor
 * requirements, collateral adequacy, insurance requirements, and franchise
 * directory hooks. Assembles blockers, required documents, and UNRESOLVED
 * determinations.
 *
 * CRITICAL: this never claims an SBA approval. `assembleSbaIntelligence` carries
 * an explicit `approvalClaim: "NOT_AN_APPROVAL"`. It surfaces what must be
 * resolved; a human authorizes. Pure — no DB.
 */

import {
  checkEligibility,
  detectSopExceptions,
  SOP_VERSION,
  type SbaApplication,
  type SbaProgram,
  type EligibilityFinding,
} from "@/lib/finengine/sba/eligibility";

export type EpcOcStructure = {
  isEpcOc: boolean;
  /** EPC (holding entity) provides its collateral as security. */
  epcPledgesCollateral?: boolean;
  /** OC (operating company) guarantees the EPC loan. */
  ocGuarantees?: boolean;
  /** EPC guarantees / OC pledges as applicable. */
  epcGuarantees?: boolean;
  /** Lease assignment from OC to lender in place. */
  leaseAssignmentInPlace?: boolean;
};

export type StandbyDebt = {
  creditorName: string;
  amount: number;
  /** True = full standby (no P&I) for the SBA loan term. */
  fullStandby: boolean;
  standbyAgreementExecuted: boolean;
  /** Seller note on a change of ownership (can count toward equity if full standby). */
  isSellerNote?: boolean;
};

export type SbaGuarantor = {
  ownerName: string;
  /** Ownership fraction (0..1). */
  ownershipPct: number;
  personalGuaranteeObtained: boolean;
};

export type SbaCollateralItem = {
  description: string;
  type: string;
  value: number;
  /** Discount applied to reach SBA collateral value (e.g. 0.20 → 80% advance). */
  discountRate: number;
};

export type InsuranceRequirement = {
  type: "HAZARD" | "FLOOD" | "LIFE" | "LIABILITY" | string;
  required: boolean;
  inPlace: boolean;
};

export type SbaIntelligenceInput = {
  app: SbaApplication;
  loanAmount: number;
  epcOc?: EpcOcStructure;
  standbyDebts?: StandbyDebt[];
  guarantors?: SbaGuarantor[];
  collateral?: SbaCollateralItem[];
  insurance?: InsuranceRequirement[];
  isFranchise?: boolean;
  franchiseInSbaDirectory?: boolean;
};

export type SbaIntelligence = {
  program: SbaProgram;
  eligible: boolean;
  approvalClaim: "NOT_AN_APPROVAL";
  eligibilityFindings: EligibilityFinding[];
  structureFindings: EligibilityFinding[];
  collateralCoverage: number | null;
  qualifyingStandbyForEquity: number;
  blockers: string[];
  requiredDocuments: string[];
  unresolvedDeterminations: string[];
};

const cite = (s: string) => `${SOP_VERSION} ${s}`;

/** EPC/OC: both entities must be bound and the lease assigned. */
export function validateEpcOc(epcOc: EpcOcStructure): EligibilityFinding[] {
  if (!epcOc.isEpcOc) return [];
  const findings: EligibilityFinding[] = [];
  findings.push({
    rule: "epc_oc_oc_guaranty",
    status: epcOc.ocGuarantees ? "PASS" : "FAIL",
    detail: epcOc.ocGuarantees ? "Operating company guarantees the EPC loan." : "OC guaranty of the EPC loan is required.",
    citation: cite("§B — EPC/OC"),
  });
  findings.push({
    rule: "epc_oc_lease_assignment",
    status: epcOc.leaseAssignmentInPlace ? "PASS" : "EXCEPTION",
    detail: epcOc.leaseAssignmentInPlace ? "OC→EPC lease assigned to lender." : "Lease assignment not yet in place.",
    citation: cite("§B — EPC/OC Lease"),
  });
  return findings;
}

/** Standby debt: full-standby seller notes can count toward equity injection. */
export function treatStandbyDebt(debts: StandbyDebt[]): {
  findings: EligibilityFinding[];
  qualifyingStandbyForEquity: number;
} {
  const findings: EligibilityFinding[] = [];
  let qualifyingStandbyForEquity = 0;
  for (const d of debts) {
    const qualifies = d.fullStandby && d.standbyAgreementExecuted && !!d.isSellerNote;
    if (qualifies) qualifyingStandbyForEquity += d.amount;
    findings.push({
      rule: "standby_debt",
      status: d.standbyAgreementExecuted ? (d.fullStandby ? "PASS" : "EXCEPTION") : "FAIL",
      detail: `${d.creditorName}: ${d.fullStandby ? "full" : "partial"} standby, agreement ${d.standbyAgreementExecuted ? "executed" : "NOT executed"}.`,
      citation: cite("§B — Standby Agreements"),
    });
  }
  return { findings, qualifyingStandbyForEquity };
}

/** Every owner of 20%+ must provide an unlimited personal guaranty. */
export function guarantorRequirements(guarantors: SbaGuarantor[]): EligibilityFinding[] {
  const findings: EligibilityFinding[] = [];
  for (const g of guarantors) {
    if (g.ownershipPct >= 0.2) {
      findings.push({
        rule: "personal_guaranty",
        status: g.personalGuaranteeObtained ? "PASS" : "FAIL",
        detail: `${g.ownerName} (${(g.ownershipPct * 100).toFixed(0)}%): personal guaranty ${g.personalGuaranteeObtained ? "obtained" : "REQUIRED"}.`,
        citation: cite("§B — Guaranties (20%+ owners)"),
      });
    }
  }
  return findings;
}

/** Collateral coverage on a discounted basis. Undersecured is NOT ineligible. */
export function collateralAdequacy(collateral: SbaCollateralItem[], loanAmount: number): {
  coverage: number | null;
  findings: EligibilityFinding[];
} {
  if (collateral.length === 0 || loanAmount <= 0) return { coverage: null, findings: [] };
  const discounted = collateral.reduce((s, c) => s + c.value * (1 - c.discountRate), 0);
  const coverage = discounted / loanAmount;
  const findings: EligibilityFinding[] = [
    {
      rule: "collateral_adequacy",
      // SBA takes available collateral; a shortfall is a condition, not ineligibility.
      status: coverage >= 1 ? "PASS" : "EXCEPTION",
      detail: `Discounted collateral coverage ${(coverage * 100).toFixed(0)}% of loan. ${coverage >= 1 ? "Fully secured." : "Take all available collateral; loan is not fully secured."}`,
      citation: cite("§B — Collateral"),
    },
  ];
  return { coverage, findings };
}

/** Insurance requirements — required-but-not-in-place surfaces as a condition. */
export function insuranceRequirements(insurance: InsuranceRequirement[]): EligibilityFinding[] {
  return insurance
    .filter((i) => i.required)
    .map((i) => ({
      rule: `insurance_${i.type.toLowerCase()}`,
      status: i.inPlace ? "PASS" : "EXCEPTION",
      detail: `${i.type} insurance ${i.inPlace ? "in place" : "required prior to disbursement"}.`,
      citation: cite("§B — Insurance"),
    }));
}

/** Franchise must appear in the SBA Franchise Directory to be eligible. */
export function franchiseCheck(isFranchise: boolean, inDirectory: boolean | undefined): EligibilityFinding[] {
  if (!isFranchise) return [];
  return [
    {
      rule: "franchise_directory",
      status: inDirectory ? "PASS" : "FAIL",
      detail: inDirectory ? "Franchise listed in SBA Franchise Directory." : "Franchise not confirmed in SBA Franchise Directory.",
      citation: cite("§A — Franchise Eligibility"),
    },
  ];
}

const DOC_FOR_RULE: Record<string, string> = {
  irs_4506c: "IRS Form 4506-C",
  personal_guaranty: "SBA Form 148 (Unconditional Guarantee)",
  standby_debt: "Standby Agreement (SBA Form 155)",
  epc_oc_lease_assignment: "Assignment of Lease",
  franchise_directory: "SBA Franchise Directory confirmation",
  insurance_flood: "Flood Insurance Policy",
  insurance_hazard: "Hazard Insurance Policy",
  insurance_life: "Life Insurance Assignment",
};

export function assembleSbaIntelligence(input: SbaIntelligenceInput): SbaIntelligence {
  const { eligible, findings: eligibilityFindings } = checkEligibility(input.app);
  const exceptions = detectSopExceptions(input.app);

  const structureFindings: EligibilityFinding[] = [];
  if (input.epcOc) structureFindings.push(...validateEpcOc(input.epcOc));

  let qualifyingStandbyForEquity = 0;
  if (input.standbyDebts) {
    const st = treatStandbyDebt(input.standbyDebts);
    structureFindings.push(...st.findings);
    qualifyingStandbyForEquity = st.qualifyingStandbyForEquity;
  }
  if (input.guarantors) structureFindings.push(...guarantorRequirements(input.guarantors));

  let collateralCoverage: number | null = null;
  if (input.collateral) {
    const ca = collateralAdequacy(input.collateral, input.loanAmount);
    collateralCoverage = ca.coverage;
    structureFindings.push(...ca.findings);
  }
  if (input.insurance) structureFindings.push(...insuranceRequirements(input.insurance));
  if (input.isFranchise) structureFindings.push(...franchiseCheck(true, input.franchiseInSbaDirectory));

  const allFindings = [...eligibilityFindings, ...structureFindings];
  const blockers = allFindings.filter((f) => f.status === "FAIL").map((f) => f.rule);
  const unresolvedDeterminations = [
    ...exceptions.map((e) => e.rule),
    ...structureFindings.filter((f) => f.status === "EXCEPTION").map((f) => f.rule),
  ];

  const requiredDocuments = [
    ...new Set(
      allFindings
        .filter((f) => f.status !== "PASS")
        .map((f) => DOC_FOR_RULE[f.rule])
        .filter((d): d is string => !!d),
    ),
  ];

  return {
    program: input.app.program,
    eligible: eligible && blockers.length === 0,
    approvalClaim: "NOT_AN_APPROVAL",
    eligibilityFindings,
    structureFindings,
    collateralCoverage,
    qualifyingStandbyForEquity,
    blockers: [...new Set(blockers)],
    requiredDocuments,
    unresolvedDeterminations: [...new Set(unresolvedDeterminations)],
  };
}

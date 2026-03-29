/**
 * SBA E-Tran Submission Readiness — Phase 58C
 *
 * Maps deal data to E-Tran required fields and returns a structured
 * readiness report. E-Tran is the SBA's electronic portal where approved
 * lenders submit 7(a) loan applications for SBA authorization.
 *
 * Pure functions. No DB. No LLM. No side effects.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EtranFieldStatus = "present" | "missing" | "partial";
export type EtranFieldPriority = "required" | "conditional" | "recommended";

export interface EtranField {
  id: string;
  label: string;
  priority: EtranFieldPriority;
  status: EtranFieldStatus;
  currentValue: string | null;
  missingReason: string | null;
  builderSection: BuilderSectionKey;
  builderFieldHint: string;
}

export type BuilderSectionKey =
  | "business"
  | "parties"
  | "structure"
  | "collateral"
  | "story"
  | "financials";

export interface EtranReadinessReport {
  dealId: string;
  computedAt: string;
  overallStatus: "READY" | "NOT_READY";
  requiredFieldCount: number;
  requiredPresentCount: number;
  conditionalFieldCount: number;
  conditionalPresentCount: number;
  completionPct: number;
  fields: EtranField[];
  blockers: EtranField[];
  warnings: EtranField[];
  readyToSubmit: boolean;
}

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

export interface EtranReadinessInput {
  dealId: string;
  loanAmount: number | null;
  dealType: string | null;

  business: {
    legalEntityName?: string | null;
    ein?: string | null;
    entityType?: string | null;
    businessAddress?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    naicsCode?: string | null;
    dateFormed?: string | null;
    employeeCount?: number | null;
  };

  owners: Array<{
    fullLegalName?: string | null;
    ownershipPct?: number | null;
    ssn_last4?: string | null;
    homeAddress?: string | null;
    homeCity?: string | null;
    homeState?: string | null;
    homeZip?: string | null;
  }>;

  guarantors: Array<{
    fullLegalName?: string | null;
    ssn_last4?: string | null;
    guarantyType?: string | null;
  }>;
  noGuarantors?: boolean;

  structure: {
    loanPurpose?: string | null;
    desiredTermMonths?: number | null;
    equityInjectionAmount?: number | null;
    equityInjectionSource?: string | null;
  };

  proceedsTotal: number | null;
  proceedsLineCount: number;
  collateralItemCount: number;

  story: {
    loanPurposeNarrative?: string | null;
    managementQualifications?: string | null;
  };

  grossAnnualRevenue: number | null;
  hasSbaAssumptions: boolean;
  hasConfirmedAssumptions: boolean;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function computeEtranReadiness(
  input: EtranReadinessInput,
): EtranReadinessReport {
  const fields: EtranField[] = [
    // ── BUSINESS ENTITY ────────────────────────────────────────────────────
    {
      id: "business_legal_name",
      label: "Business Legal Name",
      priority: "required",
      status: isPresent(input.business.legalEntityName),
      currentValue: truncate(input.business.legalEntityName),
      missingReason:
        isPresent(input.business.legalEntityName) === "present"
          ? null
          : "Legal entity name required exactly as registered \u2014 used for E-Tran application header",
      builderSection: "business",
      builderFieldHint: "Legal Entity Name",
    },
    {
      id: "business_ein",
      label: "EIN (Employer ID Number)",
      priority: "required",
      status: isPresent(input.business.ein),
      currentValue: input.business.ein ? "XX-XXXXXXX" : null,
      missingReason:
        isPresent(input.business.ein) === "present"
          ? null
          : "EIN is required for all SBA loan applications \u2014 9-digit format XX-XXXXXXX",
      builderSection: "business",
      builderFieldHint: "EIN",
    },
    {
      id: "business_entity_type",
      label: "Business Entity Type",
      priority: "required",
      status: isPresent(input.business.entityType),
      currentValue: input.business.entityType ?? null,
      missingReason:
        isPresent(input.business.entityType) === "present"
          ? null
          : "Entity type required (LLC, S-Corp, C-Corp, Partnership, Sole Proprietorship, etc.)",
      builderSection: "business",
      builderFieldHint: "Entity Type",
    },
    {
      id: "business_address",
      label: "Business Street Address",
      priority: "required",
      status: addressStatus(
        input.business.businessAddress,
        input.business.city,
        input.business.state,
        input.business.zip,
      ),
      currentValue: buildAddressSummary(input.business),
      missingReason:
        addressStatus(
          input.business.businessAddress,
          input.business.city,
          input.business.state,
          input.business.zip,
        ) === "present"
          ? null
          : "Complete business address required (street, city, state, ZIP)",
      builderSection: "business",
      builderFieldHint: "Business Address",
    },
    {
      id: "naics_code",
      label: "NAICS Code",
      priority: "required",
      status: isPresent(input.business.naicsCode),
      currentValue: input.business.naicsCode ?? null,
      missingReason:
        isPresent(input.business.naicsCode) === "present"
          ? null
          : "6-digit NAICS code required \u2014 determines SBA size standards and program eligibility",
      builderSection: "business",
      builderFieldHint: "NAICS Code",
    },
    {
      id: "date_formed",
      label: "Business Date Established",
      priority: "required",
      status: isPresent(input.business.dateFormed),
      currentValue: input.business.dateFormed ?? null,
      missingReason:
        isPresent(input.business.dateFormed) === "present"
          ? null
          : "Date business was established or incorporated \u2014 required for E-Tran and determines new/existing business underwriting path",
      builderSection: "business",
      builderFieldHint: "Date Formed",
    },
    {
      id: "employee_count",
      label: "Number of Employees",
      priority: "required",
      status:
        input.business.employeeCount != null &&
        input.business.employeeCount >= 0
          ? "present"
          : "missing",
      currentValue:
        input.business.employeeCount != null
          ? String(input.business.employeeCount)
          : null,
      missingReason:
        input.business.employeeCount != null
          ? null
          : "Employee count required \u2014 SBA uses this to verify size standard eligibility",
      builderSection: "business",
      builderFieldHint: "Employee Count",
    },
    {
      id: "gross_revenue",
      label: "Gross Annual Revenue (Most Recent Year)",
      priority: "required",
      status:
        input.grossAnnualRevenue != null && input.grossAnnualRevenue > 0
          ? "present"
          : "missing",
      currentValue:
        input.grossAnnualRevenue != null
          ? "$" + Math.round(input.grossAnnualRevenue).toLocaleString()
          : null,
      missingReason:
        input.grossAnnualRevenue != null
          ? null
          : "Gross annual revenue required for SBA size standard verification \u2014 extracted from financial statements",
      builderSection: "financials",
      builderFieldHint: "Total Revenue (most recent year in spread)",
    },

    // ── LOAN STRUCTURE ─────────────────────────────────────────────────────
    {
      id: "loan_amount",
      label: "Requested Loan Amount",
      priority: "required",
      status:
        input.loanAmount != null && input.loanAmount > 0
          ? "present"
          : "missing",
      currentValue:
        input.loanAmount != null
          ? "$" + Math.round(input.loanAmount).toLocaleString()
          : null,
      missingReason:
        input.loanAmount != null && input.loanAmount > 0
          ? null
          : "Requested loan amount required",
      builderSection: "structure",
      builderFieldHint: "Requested Amount",
    },
    {
      id: "loan_term",
      label: "Requested Loan Term",
      priority: "required",
      status:
        input.structure.desiredTermMonths != null &&
        input.structure.desiredTermMonths > 0
          ? "present"
          : "missing",
      currentValue:
        input.structure.desiredTermMonths != null
          ? `${input.structure.desiredTermMonths} months`
          : null,
      missingReason:
        input.structure.desiredTermMonths != null
          ? null
          : "Loan term in months required",
      builderSection: "structure",
      builderFieldHint: "Desired Term (months)",
    },
    {
      id: "loan_purpose",
      label: "Loan Purpose Narrative",
      priority: "required",
      status: isPresent(input.story.loanPurposeNarrative, 20),
      currentValue: truncate(input.story.loanPurposeNarrative),
      missingReason:
        isPresent(input.story.loanPurposeNarrative, 20) === "present"
          ? null
          : "Plain-English description of loan purpose required (minimum 20 characters) \u2014 E-Tran requires a clear statement of use of proceeds",
      builderSection: "story",
      builderFieldHint: "Why does this business need this loan right now?",
    },
    {
      id: "use_of_proceeds",
      label: "Use of Proceeds (Line Items)",
      priority: "required",
      status: input.proceedsLineCount > 0 ? "present" : "missing",
      currentValue:
        input.proceedsLineCount > 0
          ? `${input.proceedsLineCount} line item(s), total: $${Math.round(input.proceedsTotal ?? 0).toLocaleString()}`
          : null,
      missingReason:
        input.proceedsLineCount > 0
          ? null
          : "At least one use-of-proceeds line item required \u2014 itemize how loan proceeds will be deployed",
      builderSection: "structure",
      builderFieldHint: "Use of Proceeds (Edit Proceeds)",
    },

    // ── OWNERS & GUARANTORS ────────────────────────────────────────────────
    {
      id: "owner_info",
      label: "Owner(s) \u2014 Name & Ownership %",
      priority: "required",
      status:
        input.owners.length > 0 &&
        input.owners.every(
          (o) =>
            isPresent(o.fullLegalName) === "present" &&
            (o.ownershipPct ?? 0) > 0,
        )
          ? "present"
          : input.owners.length > 0
            ? "partial"
            : "missing",
      currentValue:
        input.owners.length > 0
          ? input.owners
              .map(
                (o) =>
                  `${o.fullLegalName ?? "Unknown"} (${o.ownershipPct ?? 0}%)`,
              )
              .join(", ")
          : null,
      missingReason:
        input.owners.length === 0
          ? "At least one owner required with full legal name and ownership percentage"
          : input.owners.some(
                (o) => !o.fullLegalName || !(o.ownershipPct ?? 0),
              )
            ? "All owners must have full legal name and ownership percentage"
            : null,
      builderSection: "parties",
      builderFieldHint: "Add Owner / Edit Owner",
    },
    {
      id: "guarantor_ssn",
      label: "Guarantor SSN (Last 4) for 20%+ Owners",
      priority: "required",
      status: (() => {
        if (input.noGuarantors) return "present";
        const majorOwners = input.owners.filter(
          (o) => (o.ownershipPct ?? 0) >= 20,
        );
        if (majorOwners.length === 0) return "present";
        return majorOwners.every(
          (o) => isPresent(o.ssn_last4) === "present",
        )
          ? "present"
          : "missing";
      })(),
      currentValue: input.noGuarantors
        ? "No personal guaranty waived"
        : (input.owners
            .filter(
              (o) => (o.ownershipPct ?? 0) >= 20 && o.ssn_last4,
            )
            .map(
              (o) =>
                `${o.fullLegalName ?? "Owner"}: ****${o.ssn_last4}`,
            )
            .join(", ") || null),
      missingReason: (() => {
        if (input.noGuarantors) return null;
        const needsSSN = input.owners.filter(
          (o) => (o.ownershipPct ?? 0) >= 20 && !o.ssn_last4,
        );
        return needsSSN.length > 0
          ? `${needsSSN.map((o) => o.fullLegalName ?? "Owner").join(", ")} own 20%+ and must provide SSN (last 4) for personal guaranty per SBA SOP 50 10 8`
          : null;
      })(),
      builderSection: "parties",
      builderFieldHint: "Owner SSN Last 4 (in Owner drawer)",
    },
    {
      id: "guarantor_home_address",
      label: "Guarantor Home Address for 20%+ Owners",
      priority: "required",
      status: (() => {
        if (input.noGuarantors) return "present";
        const majorOwners = input.owners.filter(
          (o) => (o.ownershipPct ?? 0) >= 20,
        );
        if (majorOwners.length === 0) return "present";
        return majorOwners.every(
          (o) =>
            isPresent(o.homeAddress) === "present" &&
            isPresent(o.homeCity) === "present" &&
            isPresent(o.homeState) === "present" &&
            isPresent(o.homeZip) === "present",
        )
          ? "present"
          : "missing";
      })(),
      currentValue: null,
      missingReason: (() => {
        if (input.noGuarantors) return null;
        const needsAddress = input.owners.filter(
          (o) =>
            (o.ownershipPct ?? 0) >= 20 &&
            (!o.homeAddress || !o.homeCity || !o.homeState || !o.homeZip),
        );
        return needsAddress.length > 0
          ? `${needsAddress.map((o) => o.fullLegalName ?? "Owner").join(", ")}: home address required for personal guaranty`
          : null;
      })(),
      builderSection: "parties",
      builderFieldHint: "Owner Home Address (in Owner drawer)",
    },

    // ── EQUITY INJECTION ───────────────────────────────────────────────────
    {
      id: "equity_injection",
      label: "Equity Injection Amount & Source",
      priority: "conditional",
      status: (() => {
        if ((input.structure.equityInjectionAmount ?? 0) === 0)
          return "present";
        return isPresent(input.structure.equityInjectionSource);
      })(),
      currentValue: input.structure.equityInjectionAmount
        ? `$${Math.round(input.structure.equityInjectionAmount).toLocaleString()} \u2014 ${input.structure.equityInjectionSource ?? "source not specified"}`
        : "Not applicable",
      missingReason:
        (input.structure.equityInjectionAmount ?? 0) > 0 &&
        !input.structure.equityInjectionSource
          ? "Equity injection source required when injection amount is specified (e.g., borrower cash, seller note, gift)"
          : null,
      builderSection: "structure",
      builderFieldHint: "Equity Injection Source",
    },

    // ── COLLATERAL ─────────────────────────────────────────────────────────
    {
      id: "collateral",
      label: "Collateral Description",
      priority: "recommended",
      status: input.collateralItemCount > 0 ? "present" : "missing",
      currentValue:
        input.collateralItemCount > 0
          ? `${input.collateralItemCount} collateral item(s)`
          : null,
      missingReason:
        input.collateralItemCount === 0
          ? "Collateral package not yet defined \u2014 SBA lenders are required to take available collateral; document collateral even if unsecured"
          : null,
      builderSection: "collateral",
      builderFieldHint: "Add Collateral",
    },

    // ── MANAGEMENT ─────────────────────────────────────────────────────────
    {
      id: "management_background",
      label: "Management Background",
      priority: "recommended",
      status: isPresent(input.story.managementQualifications, 30),
      currentValue: truncate(input.story.managementQualifications),
      missingReason:
        isPresent(input.story.managementQualifications, 30) === "present"
          ? null
          : "Management qualifications narrative helps underwriters verify industry experience \u2014 particularly important for new businesses",
      builderSection: "story",
      builderFieldHint: "What makes this management team qualified?",
    },
  ];

  // ── Compute summary ──────────────────────────────────────────────────────

  const required = fields.filter((f) => f.priority === "required");
  const conditional = fields.filter((f) => f.priority === "conditional");
  const requiredPresent = required.filter(
    (f) => f.status === "present",
  ).length;
  const conditionalPresent = conditional.filter(
    (f) => f.status === "present",
  ).length;

  const blockers = required.filter((f) => f.status !== "present");
  const warnings = [
    ...conditional,
    ...fields.filter((f) => f.priority === "recommended"),
  ].filter((f) => f.status !== "present");

  const completionPct =
    required.length > 0 ? requiredPresent / required.length : 1;
  const readyToSubmit = blockers.length === 0;

  return {
    dealId: input.dealId,
    computedAt: new Date().toISOString(),
    overallStatus: readyToSubmit ? "READY" : "NOT_READY",
    requiredFieldCount: required.length,
    requiredPresentCount: requiredPresent,
    conditionalFieldCount: conditional.length,
    conditionalPresentCount: conditionalPresent,
    completionPct,
    fields,
    blockers,
    warnings,
    readyToSubmit,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPresent(
  value: string | null | undefined,
  minLength = 1,
): EtranFieldStatus {
  if (!value || value.trim().length < minLength) return "missing";
  return "present";
}

function truncate(
  value: string | null | undefined,
  max = 60,
): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) + "\u2026" : value;
}

function addressStatus(
  street: string | null | undefined,
  city: string | null | undefined,
  state: string | null | undefined,
  zip: string | null | undefined,
): EtranFieldStatus {
  const parts = [street, city, state, zip].filter(
    (p) => p && p.trim().length > 0,
  );
  if (parts.length === 4) return "present";
  if (parts.length > 0) return "partial";
  return "missing";
}

function buildAddressSummary(
  business: EtranReadinessInput["business"],
): string | null {
  const parts = [
    business.businessAddress,
    business.city,
    business.state,
    business.zip,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * SPEC-BIE-DERIVATION-AUDIT-AND-EVIDENCE-PROMOTION-1 — foundation
 *
 * Pure, deterministic projection that classifies the evidence already available
 * to a committee decision (borrower story, financial-fact keys, loan request,
 * management profiles, NAICS, source snapshots, committee tasks) into explicit
 * evidence CLASSES — so narratives can promote real borrower/file evidence
 * instead of bluntly calling everything "missing".
 *
 * No DB / network / AI. No fabricated facts — every classification is derived
 * from the inputs passed in (which quality.ts already loads). NEVER upgrades
 * borrower/file evidence to committee-grade.
 */

export type EvidenceClass =
  | "missing"
  | "borrower_supported"
  | "file_supported"
  | "public_supported"
  | "official_supported"
  | "banker_attested"
  | "committee_grade"
  | "contradicted"
  | "not_derivable";

export type FactorStatus = "Supported" | "Partially supported" | "Missing" | "Not derivable" | "Contradicted";

export interface DecisionEvidenceFactor {
  factor: string;
  status: FactorStatus;
  evidenceClass: EvidenceClass;
  label: string;
  reason: string;
}

export interface ResearchFact {
  key: string;
  value: string;
  source: string;
  confidence: number;
}

export interface DecisionEvidenceProjection {
  privateCompanyEvidenceMode: boolean;
  /**
   * SPEC-SCALE-PLAUSIBILITY-RECONCILIATION-1: the latest quality gate still has
   * scale_plausibility flagged as a committee blocker (gate-derived, NOT a task).
   * When true, the Business Scale verdict is capped until an analyst records the
   * scale-plausibility conclusion — even though the evidence factors are strong.
   */
  scalePlausibilityUnresolved: boolean;
  /** Six Business Scale factors. */
  scaleFactors: DecisionEvidenceFactor[];
  industry: {
    naicsCode: string | null;
    naicsDescription: string | null;
    understanding: DecisionEvidenceFactor;
    independentSource: DecisionEvidenceFactor;
  };
  management: {
    principals: Array<{ name: string; title: string | null }>;
    profilePresent: boolean;
    publicVerification: boolean;
    adverseStatus: "manual_clear_attested" | "official_captured" | "not_run";
  };
  publicRecords: {
    attestedClear: boolean;
    officialCaptured: boolean;
    searchFormOnly: boolean;
    status: "official_captured" | "manual_clear_attested" | "search_form_only" | "not_run";
  };
}

export interface ResearchFactProjection {
  facts: ResearchFact[];
}

/** Minimal task shape the projection reads (subset of CommitteeEvidenceTask). */
export type ProjectionTask = {
  task_type?: string | null;
  review_status?: string | null;
  review_reason?: string | null;
  resolved_status?: string | null;
  status?: string | null;
  committee_grade_accepted?: boolean | null;
  collected_items?: string[] | null;
  official_capture_available?: boolean | null;
  official_capture_status?: string | null;
};

export type EvidenceProjectionInput = {
  /** fact_key values from deal_financial_facts (presence is enough to classify). */
  financialFactKeys: string[];
  borrowerStory: Record<string, unknown> | null;
  loan: Record<string, unknown> | null;
  managementProfiles: Array<{ person_name?: string | null; title?: string | null; source?: string | null }>;
  naicsCode: string | null;
  naicsDescription: string | null;
  sourceSnapshots: Array<{ source_type?: string | null; status?: string | null }>;
  committeeTasks: ProjectionTask[];
  privateCompanyEvidenceMode: boolean;
  /** From the quality gate's management_validation_check, if available. */
  managementValidationPass?: boolean;
  principalsConfirmed?: number;
  // SPEC-SCALE-PLAUSIBILITY-RECONCILIATION-1: gate-derived scale-plausibility state.
  contradictionChecklist?: Array<Record<string, unknown>>;
  committeeBlockers?: string[];
};

/**
 * SPEC-SCALE-PLAUSIBILITY-RECONCILIATION-1: detect an UNRESOLVED scale-plausibility
 * committee blocker from the latest quality gate. Primary signal is the
 * contradiction_checklist item; the committee_blockers string list is the fallback
 * (the live gate stores "Contradiction check unresolved: scale_plausibility"
 * there). Deliberately does NOT consult buddy_research_committee_tasks — the live
 * deal has no dedicated scale task row; the blocker is gate-derived.
 */
export function hasUnresolvedScalePlausibilityBlocker(input: {
  contradictionChecklist?: Array<Record<string, unknown>>;
  committeeBlockers?: string[];
}): boolean {
  for (const item of input.contradictionChecklist ?? []) {
    const key = String(item?.["check_key"] ?? item?.["key"] ?? "").toLowerCase();
    if (key !== "scale_plausibility") continue;
    const status = String(item?.["status"] ?? "").toLowerCase();
    if (item?.["committee_blocker"] === true && status !== "clear" && status !== "resolved") return true;
  }
  if ((input.committeeBlockers ?? []).some((b) => /scale_plausibility/i.test(String(b)))) return true;
  return false;
}

const has = (v: unknown): boolean => {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return Number.isFinite(v) && v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return !!v;
};

const factKeyMatches = (keys: string[], re: RegExp): boolean => keys.some((k) => re.test(String(k)));

const collectedItemsOf = (tasks: ProjectionTask[]): string[] =>
  tasks.flatMap((t) => (Array.isArray(t.collected_items) ? t.collected_items : [])).map((s) => String(s));

function tasksOfType(tasks: ProjectionTask[], re: RegExp): ProjectionTask[] {
  return tasks.filter((t) => re.test(String(t.task_type ?? "")));
}

function snapshotHas(snaps: EvidenceProjectionInput["sourceSnapshots"], re: RegExp): boolean {
  return snaps.some((s) => re.test(String(s.source_type ?? "")) && String(s.status ?? "") === "collected");
}

// ── Business Scale factors ─────────────────────────────────────────────────────

function revenueFactor(i: EvidenceProjectionInput): DecisionEvidenceFactor {
  if (factKeyMatches(i.financialFactKeys, /TOTAL_REVENUE|GROSS_PROFIT|NET_INCOME|DSCR|REVENUE|INCOME/i)) {
    return { factor: "Revenue support", status: "Supported", evidenceClass: "file_supported", label: "Revenue / income facts on file", reason: "Revenue, income or DSCR facts are present from financial statements / tax returns." };
  }
  return { factor: "Revenue support", status: "Missing", evidenceClass: "missing", label: "No revenue facts", reason: "No revenue/income/DSCR fact is present in the loaded financials." };
}

function loanRequestFactor(i: EvidenceProjectionInput): DecisionEvidenceFactor {
  const loan = i.loan ?? {};
  const collected = collectedItemsOf(i.committeeTasks);
  if (has(loan.use_of_proceeds) || (has(loan.product_type) && has(loan.requested_amount)) || has(loan.purpose) || has(loan.loan_purpose)) {
    return { factor: "Loan request / use of proceeds", status: "Supported", evidenceClass: "file_supported", label: "Loan request on file", reason: "A structured loan request / use of proceeds is on file." };
  }
  if (collected.some((c) => /loan request|use of proceeds/i.test(c))) {
    return { factor: "Loan request / use of proceeds", status: "Supported", evidenceClass: "file_supported", label: "Loan request collected", reason: "Loan request / use of proceeds is captured in the committee evidence." };
  }
  return { factor: "Loan request / use of proceeds", status: "Missing", evidenceClass: "missing", label: "No loan request", reason: "No usable loan request / use of proceeds is on file." };
}

function arConcentrationFactor(i: EvidenceProjectionInput): DecisionEvidenceFactor {
  if (factKeyMatches(i.financialFactKeys, /AR_SCH_L|ACCOUNTS_RECEIVABLE|\bAR\b|AR_AGING|RECEIVABLE/i)) {
    return { factor: "AR / customer concentration", status: "Supported", evidenceClass: "file_supported", label: "AR facts on file", reason: "Accounts-receivable facts are present from the financials." };
  }
  if (has(i.borrowerStory?.["customer_concentration"]) || has(i.borrowerStory?.["customers"])) {
    return { factor: "AR / customer concentration", status: "Partially supported", evidenceClass: "borrower_supported", label: "Customer-concentration narrative on file", reason: "Borrower story documents customers / concentration; AR schedule not independently verified." };
  }
  return { factor: "AR / customer concentration", status: "Missing", evidenceClass: "missing", label: "No AR / concentration support", reason: "No AR facts or customer-concentration narrative on file." };
}

function capacityFactor(i: EvidenceProjectionInput): DecisionEvidenceFactor {
  if (factKeyMatches(i.financialFactKeys, /SALAR|WAGE|PAYROLL|HEADCOUNT|EMPLOYEE|LABOR/i)) {
    return { factor: "Capacity / staffing", status: "Supported", evidenceClass: "file_supported", label: "Staffing / payroll facts on file", reason: "Payroll / staffing facts are present from the financials." };
  }
  if (has(i.borrowerStory?.["growth_strategy"]) || has(i.borrowerStory?.["business_description"])) {
    return { factor: "Capacity / staffing", status: "Partially supported", evidenceClass: "borrower_supported", label: "Capacity / growth narrative on file", reason: "Borrower story describes operations / growth; headcount not independently verified." };
  }
  return { factor: "Capacity / staffing", status: "Not derivable", evidenceClass: "not_derivable", label: "Capacity not derivable", reason: "No payroll/headcount fact and no operating narrative to infer capacity." };
}

function collateralFactor(i: EvidenceProjectionInput): DecisionEvidenceFactor {
  const collected = collectedItemsOf(i.committeeTasks);
  if (collected.some((c) => /collateral/i.test(c)) || factKeyMatches(i.financialFactKeys, /COLLATERAL|AR_SCH_L|RECEIVABLE/i)) {
    return { factor: "Collateral support", status: "Supported", evidenceClass: "file_supported", label: "Collateral records on file", reason: "Collateral records / AR are present in the file." };
  }
  if (has(i.loan?.["collateral_summary"]) || has(i.loan?.["property_type"])) {
    return { factor: "Collateral support", status: "Partially supported", evidenceClass: "borrower_supported", label: "Collateral described in loan request", reason: "Collateral is described in the loan request; specific records not independently verified." };
  }
  return { factor: "Collateral support", status: "Missing", evidenceClass: "missing", label: "No collateral support", reason: "No collateral records or description on file." };
}

function industryContextFactor(i: EvidenceProjectionInput): DecisionEvidenceFactor {
  const independent = snapshotHas(i.sourceSnapshots, /industry|market|government|trade|census|bls|fred/i);
  if (independent) {
    return { factor: "Industry context", status: "Supported", evidenceClass: "public_supported", label: "Independent industry/market source on file", reason: "An independent industry/market source snapshot is on file." };
  }
  if (has(i.naicsCode) || has(i.borrowerStory?.["competitive_position"]) || has(i.borrowerStory?.["business_description"])) {
    return { factor: "Industry context", status: "Partially supported", evidenceClass: "borrower_supported", label: "NAICS + borrower industry narrative on file", reason: "Industry understood from NAICS / borrower story; independent committee-grade source still missing." };
  }
  return { factor: "Industry context", status: "Missing", evidenceClass: "missing", label: "No industry context", reason: "No NAICS or industry narrative on file." };
}

// ── public records / adverse ───────────────────────────────────────────────────

function publicRecordsProjection(i: EvidenceProjectionInput): DecisionEvidenceProjection["publicRecords"] {
  const adverse = tasksOfType(i.committeeTasks, /adverse|public_record|court|regulatory|sanction|lien/i);
  const attestedClear = adverse.some((t) => t.review_status === "banker_attested" && /clear/i.test(String(t.review_reason ?? "")));
  const officialCaptured = adverse.some((t) => !!t.official_capture_available);
  const searchFormOnly = adverse.some((t) => t.official_capture_status === "search_form_only");
  const status = officialCaptured
    ? "official_captured"
    : attestedClear
      ? "manual_clear_attested"
      : searchFormOnly
        ? "search_form_only"
        : "not_run";
  return { attestedClear, officialCaptured, searchFormOnly, status };
}

export function buildDecisionEvidenceProjection(i: EvidenceProjectionInput): DecisionEvidenceProjection {
  const scaleFactors = [
    revenueFactor(i),
    loanRequestFactor(i),
    arConcentrationFactor(i),
    capacityFactor(i),
    collateralFactor(i),
    industryContextFactor(i),
  ];

  const understanding: DecisionEvidenceFactor = has(i.naicsCode) || has(i.borrowerStory?.["business_description"]) || has(i.borrowerStory?.["competitive_position"])
    ? { factor: "Industry understanding", status: "Supported", evidenceClass: "borrower_supported", label: "NAICS + borrower industry narrative", reason: "Industry, customers and competitive position are understood from NAICS and borrower story." }
    : { factor: "Industry understanding", status: "Missing", evidenceClass: "missing", label: "No industry understanding", reason: "No NAICS or industry narrative on file." };
  const independent = snapshotHas(i.sourceSnapshots, /industry|market|government|trade|census|bls|fred/i)
    ? { factor: "Independent industry source", status: "Supported" as FactorStatus, evidenceClass: "public_supported" as EvidenceClass, label: "Independent industry/market source", reason: "An independent industry/market source snapshot is on file." }
    : { factor: "Independent industry source", status: "Missing" as FactorStatus, evidenceClass: "missing" as EvidenceClass, label: "No recognized independent source", reason: "No BLS/Census/FRED/IBISWorld/Statista/trade source on file (expected for a private borrower)." };

  const pubRec = publicRecordsProjection(i);

  return {
    privateCompanyEvidenceMode: i.privateCompanyEvidenceMode,
    scalePlausibilityUnresolved: hasUnresolvedScalePlausibilityBlocker(i),
    scaleFactors,
    industry: { naicsCode: i.naicsCode, naicsDescription: i.naicsDescription, understanding, independentSource: independent },
    management: {
      principals: i.managementProfiles.filter((p) => has(p.person_name)).map((p) => ({ name: String(p.person_name), title: p.title ?? null })),
      profilePresent: i.managementProfiles.length > 0,
      publicVerification: !!i.managementValidationPass || (i.principalsConfirmed ?? 0) > 0 || i.managementProfiles.some((p) => /public|sos|registry|license/i.test(String(p.source ?? ""))),
      adverseStatus: pubRec.officialCaptured ? "official_captured" : pubRec.attestedClear ? "manual_clear_attested" : "not_run",
    },
    publicRecords: pubRec,
  };
}

// ── research fact projection (J) ───────────────────────────────────────────────

export function buildResearchFactProjection(i: EvidenceProjectionInput): ResearchFactProjection {
  const facts: ResearchFact[] = [];
  const push = (key: string, value: unknown, source: string, confidence: number) => {
    if (has(value)) facts.push({ key, value: typeof value === "string" ? value : String(value), source, confidence });
  };
  const story = i.borrowerStory ?? {};
  const proj = buildDecisionEvidenceProjection(i);

  push("entity_legal_name", story["legal_name"], "borrower_story", 0.9);
  push("borrower_website", story["website"], "borrower_story", 0.8);
  push("naics_code", i.naicsCode, "research_subject", 0.9);
  push("naics_description", i.naicsDescription, "research_subject", 0.9);
  const p0 = proj.management.principals[0];
  if (p0) {
    push("principal_name", p0.name, "management_profile", 0.85);
    push("principal_role", p0.title, "management_profile", 0.7);
  }
  push("management_profile_present", proj.management.profilePresent ? "yes" : "", "management_profile", 0.8);
  push("adverse_screen_status", proj.publicRecords.status, "committee_task", 0.8);
  push("industry_source_status", proj.industry.independentSource.status, "source_snapshot", 0.8);
  push("market_source_status", proj.industry.independentSource.status, "source_snapshot", 0.7);
  push("named_customers", story["customers"] ?? story["products_services"], "borrower_story", 0.6);
  push("customer_concentration_summary", story["customer_concentration"], "borrower_story", 0.7);
  push("growth_strategy_summary", story["growth_strategy"], "borrower_story", 0.6);
  const scale = (f: string) => proj.scaleFactors.find((x) => x.factor === f);
  push("revenue_latest", scale("Revenue support")?.status === "Supported" ? "on file" : "", "financial_facts", 0.8);
  push("dscr_latest", factKeyMatches(i.financialFactKeys, /DSCR/i) ? "on file" : "", "financial_facts", 0.8);
  push("ar_support_status", scale("AR / customer concentration")?.evidenceClass ?? "", "financial_facts", 0.7);
  push("collateral_support_status", scale("Collateral support")?.status ?? "", "committee_task", 0.7);
  push("loan_request_status", scale("Loan request / use of proceeds")?.status ?? "", "loan_request", 0.8);
  push("capacity_support_status", scale("Capacity / staffing")?.status ?? "", "borrower_story", 0.6);

  return { facts };
}

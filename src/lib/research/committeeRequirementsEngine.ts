/**
 * SPEC-BIE-COMMITTEE-EVIDENCE-REQUIREMENTS-ENGINE-1
 *
 * Proactive committee-evidence requirements engine. Generates the REQUIRED
 * evidence plan for a deal from its inputs (loan type/amount/collateral, NAICS,
 * geography, private/public status, website, management, story, documents,
 * financial facts, research source snapshots, committee task/review state) so
 * predictable committee blockers are surfaced as actionable requirement GAPS
 * BEFORE research/gate failure — instead of only after the gate fails.
 *
 * Pure module — no server-only, no DB, no fabrication, fully unit-testable. It
 * NEVER changes gate scoring, trust grade, committee thresholds, or
 * preliminary/committee eligibility, and NEVER auto-clears a committee blocker.
 * It only EXPLAINS what is required and evaluates each requirement's current
 * status against the loan file + research + (rule 9) the banker review state.
 *
 * Reuses the #484 file/research probes via buildLoanFileContext so requirement
 * statuses agree with the committee evidence linkage layer.
 */

import {
  buildLoanFileContext,
  type FileContext,
  type TaskLinkInput,
} from "./committeeEvidenceLinkage";

// ── Status / category vocabulary ─────────────────────────────────────────────

export type RequirementStatus =
  | "satisfied" // committee-grade evidence on file / accepted
  | "preliminary_satisfied" // file/banker-certified for preliminary; committee verification still open
  | "needs_review" // present but needs analyst conclusion / caveat / verification
  | "open"; // missing — taskable

export type RequirementCategory =
  | "entity"
  | "management"
  | "industry"
  | "market"
  | "competitive"
  | "financial"
  | "collateral"
  | "scale"
  | "adverse";

export type RequirementGrade = "preliminary" | "committee" | "both";

export type RequiredEvidenceItem = {
  key: string;
  category: RequirementCategory;
  label: string;
  description: string;
  required_for: RequirementGrade;
  status: RequirementStatus;
  blocks_preliminary: boolean;
  blocks_committee: boolean;
  evidence_basis: string[];
  recommended_action: string;
  acceptable_evidence: string[];
  /** Human-readable committee blocker(s) this requirement prevents/explains. */
  prevents_blockers: string[];
  /** Review state of the matched committee task, when present (rule 9). */
  review_state?: { review_status: string; committee_grade_accepted: boolean } | null;
};

export type BlockerPreventionTask = {
  key: string;
  category: RequirementCategory;
  label: string;
  action: string;
  blocks_preliminary: boolean;
  blocks_committee: boolean;
  status: RequirementStatus;
};

export type CommitteeReadinessGap = {
  key: string;
  category: RequirementCategory;
  label: string;
  status: RequirementStatus;
  prevents_blockers: string[];
  recommended_action: string;
};

export type SourceCollectionPlan = {
  items: Array<{ key: string; label: string; status: RequirementStatus; collect: string }>;
};
export type AttestationPlan = {
  items: Array<{ key: string; label: string; status: RequirementStatus; attestable_for: RequirementGrade }>;
};
export type AdverseScreenPlan = {
  required: true;
  status: RequirementStatus;
  acceptable_evidence: string[];
  limitations: string;
};
export type ScalePlausibilityPlan = {
  applicable: boolean;
  status: RequirementStatus;
  auto_clear_forbidden: boolean;
  required_supports: string[];
  present_supports: string[];
  missing_supports: string[];
  analyst_conclusion_required: boolean;
};

export type CommitteeRequirementsPlan = {
  required_evidence_items: RequiredEvidenceItem[];
  optional_evidence_items: RequiredEvidenceItem[];
  blocker_prevention_tasks: BlockerPreventionTask[];
  committee_readiness_gaps: CommitteeReadinessGap[];
  source_collection_plan: SourceCollectionPlan;
  attestation_plan: AttestationPlan;
  adverse_screen_plan: AdverseScreenPlan;
  scale_plausibility_plan: ScalePlausibilityPlan;
};

// ── Inputs ───────────────────────────────────────────────────────────────────

export type RequirementsSourceSnapshot = { source_type?: string | null; status?: string | null };
export type RequirementsTaskState = {
  task_type?: string | null;
  blocker_type?: string | null;
  resolved_status?: string | null;
  review_status?: string | null;
  committee_grade_accepted?: boolean | null;
  auto_clear_forbidden?: boolean | null;
};

export type CommitteeRequirementsInput = TaskLinkInput & {
  loanType?: string | null;
  loanAmount?: number | null;
  collateralType?: string | null;
  useOfProceeds?: string | null;
  /** True when a structured use-of-proceeds / loan-request doc is on file. */
  hasStructuredLoanRequest?: boolean;
  naicsCode?: string | null;
  naicsDescription?: string | null;
  /** Borrower is a private company (limited public footprint). Defaults true. */
  isPrivate?: boolean;
  hqCity?: string | null;
  hqState?: string | null;
  legalName?: string | null;
  dba?: string | null;
  sourceSnapshots?: RequirementsSourceSnapshot[];
  committeeTasks?: RequirementsTaskState[];
};

// ── Loan-type derivation ─────────────────────────────────────────────────────

type LoanShape = {
  isLineOrWorkingCapital: boolean;
  isSecured: boolean;
  scaleApplies: boolean;
  collateralRelevant: boolean;
  arConcentrationRelevant: boolean;
};

function deriveLoanShape(input: CommitteeRequirementsInput): LoanShape {
  // Normalize separators so word boundaries match (e.g. "LOC_SECURED" → "LOC SECURED").
  const lt = (input.loanType ?? "").toUpperCase().replace(/[_\-/]+/g, " ");
  const purpose = `${input.useOfProceeds ?? ""} ${input.borrowerStory?.customer_concentration ?? ""}`;
  const isLineOrWorkingCapital =
    /\b(LOC|LINE|WORKING[_\s]?CAPITAL|WC|REVOLV)\b/.test(lt) || /working capital/i.test(purpose);
  const isSecured =
    /\b(SECURED|CRE|RE|REAL_ESTATE|EQUIP|TERM|ABL|SBA)\b/.test(lt) || !!(input.collateralType ?? "").trim();
  // Scale plausibility: large-client growth / working-capital / LOC deals.
  const scaleApplies =
    isLineOrWorkingCapital || /\b(large|fortune|enterprise|growth|scal|ramp|expansion)\b/i.test(purpose);
  return {
    isLineOrWorkingCapital,
    isSecured,
    scaleApplies,
    collateralRelevant: isSecured,
    arConcentrationRelevant: isLineOrWorkingCapital || /\bAR\b|receivable/i.test(input.collateralType ?? ""),
  };
}

// ── Review integration (rule 9) ──────────────────────────────────────────────

const ACCEPTED_OPEN_STATUSES = new Set(["rejected", "weak_source", "wrong_entity"]);

/** Map a requirement key to the committee task_type(s) that satisfy it. */
function matchTask(
  tasks: RequirementsTaskState[],
  predicate: (t: RequirementsTaskState) => boolean,
): RequirementsTaskState | null {
  return tasks.find(predicate) ?? null;
}

/**
 * Apply the matched task's review state to the file-derived base status.
 *   committee_grade_accepted → satisfied
 *   rejected / weak_source / wrong_entity → open (keep open)
 *   accepted → satisfied IF analyst acceptance suffices for committee, else the
 *     base (so a committee-grade-verification item stays preliminary/needs_review)
 *   else → base
 */
function applyReview(
  base: RequirementStatus,
  task: RequirementsTaskState | null,
  analystAcceptanceSatisfiesCommittee: boolean,
): { status: RequirementStatus; review_state: RequiredEvidenceItem["review_state"] } {
  if (!task || !task.review_status || task.review_status === "unreviewed") {
    return { status: base, review_state: task ? { review_status: "unreviewed", committee_grade_accepted: false } : null };
  }
  const review_state = {
    review_status: task.review_status,
    committee_grade_accepted: !!task.committee_grade_accepted,
  };
  if (task.committee_grade_accepted) return { status: "satisfied", review_state };
  if (ACCEPTED_OPEN_STATUSES.has(task.review_status)) return { status: "open", review_state };
  if (task.review_status === "accepted") {
    return { status: analystAcceptanceSatisfiesCommittee ? "satisfied" : base, review_state };
  }
  // needs_more_evidence and any other → base
  return { status: base, review_state };
}

// ── Item builder ─────────────────────────────────────────────────────────────

const PRELIMINARY_HARD = new Set(["entity_legal_name"]);

type ItemSpec = {
  key: string;
  category: RequirementCategory;
  label: string;
  description: string;
  required_for: RequirementGrade;
  baseStatus: RequirementStatus;
  evidence_basis: string[];
  recommended_action: string;
  acceptable_evidence: string[];
  prevents_blockers: string[];
  task: RequirementsTaskState | null;
  analystAcceptanceSatisfiesCommittee?: boolean;
};

function buildItem(spec: ItemSpec): RequiredEvidenceItem {
  const { status, review_state } = applyReview(
    spec.baseStatus,
    spec.task,
    spec.analystAcceptanceSatisfiesCommittee ?? false,
  );
  const satisfiedForCommittee = status === "satisfied";
  const satisfiedForPreliminary = status === "satisfied" || status === "preliminary_satisfied";
  const blocks_preliminary =
    spec.required_for !== "committee" && PRELIMINARY_HARD.has(spec.key) && !satisfiedForPreliminary;
  const blocks_committee = spec.required_for !== "preliminary" && !satisfiedForCommittee;
  return {
    key: spec.key,
    category: spec.category,
    label: spec.label,
    description: spec.description,
    required_for: spec.required_for,
    status,
    blocks_preliminary,
    blocks_committee,
    evidence_basis: spec.evidence_basis,
    recommended_action: spec.recommended_action,
    acceptable_evidence: spec.acceptable_evidence,
    prevents_blockers: spec.prevents_blockers,
    review_state,
  };
}

// ── Engine ───────────────────────────────────────────────────────────────────

export function buildCommitteeRequirementsPlan(
  input: CommitteeRequirementsInput,
): CommitteeRequirementsPlan {
  const ctx: FileContext = buildLoanFileContext(input);
  const loan = deriveLoanShape(input);
  const tasks = input.committeeTasks ?? [];
  const snapshots = input.sourceSnapshots ?? [];

  const websiteSnapshotCollected =
    snapshots.some((s) => s.source_type === "borrower_official_website" && s.status === "collected") ||
    ctx.websiteSources.length > 0;
  const hasLegalName = !!(input.legalName ?? "").trim() || !!(input.borrowerStory?.products_services ?? "").trim();
  const hasHq = !!(input.hqCity ?? "").trim() || !!(input.hqState ?? "").trim();

  const t = (pred: (x: RequirementsTaskState) => boolean) => matchTask(tasks, pred);

  const required: RequiredEvidenceItem[] = [];
  const optional: RequiredEvidenceItem[] = [];

  // 1. ENTITY ─────────────────────────────────────────────────────────────────
  required.push(
    buildItem({
      key: "entity_legal_name",
      category: "entity",
      label: "Legal borrower name",
      description: "Confirmed legal name of the borrower entity.",
      required_for: "both",
      baseStatus: hasLegalName ? "satisfied" : "open",
      evidence_basis: hasLegalName ? ["Borrower identity on file"] : [],
      recommended_action: "Confirm the exact legal borrower name (and DBA, if any).",
      acceptable_evidence: ["Legal entity name on the loan request / borrower profile"],
      prevents_blockers: ["Stronger public/institutional sources required"],
      task: null,
    }),
  );
  required.push(
    buildItem({
      key: "entity_website_snapshot",
      category: "entity",
      label: "Borrower official website snapshot",
      description: "Snapshot of the borrower's official website as a primary source; domain matches the legal borrower.",
      required_for: "both",
      baseStatus: websiteSnapshotCollected ? "satisfied" : "open",
      evidence_basis: websiteSnapshotCollected ? ["Borrower official website snapshot collected"] : [],
      recommended_action: "Snapshot the borrower's official website and confirm the domain matches the legal borrower.",
      acceptable_evidence: ["Borrower official website snapshot", "Domain matching the legal borrower"],
      prevents_blockers: ["Stronger public/institutional sources required"],
      task: t((x) => x.task_type === "borrower_website_snapshot"),
    }),
  );
  required.push(
    buildItem({
      key: "entity_hq",
      category: "entity",
      label: "Headquarters city/state",
      description: "Confirmed borrower HQ location.",
      required_for: "both",
      baseStatus: hasHq ? "satisfied" : "open",
      evidence_basis: hasHq ? [[input.hqCity, input.hqState].filter(Boolean).join(", ")] : [],
      recommended_action: "Confirm the borrower HQ city/state.",
      acceptable_evidence: ["HQ on borrower profile", "Official record confirming location"],
      prevents_blockers: ["Stronger public/institutional sources required"],
      task: null,
    }),
  );
  required.push(
    buildItem({
      key: "entity_sos_or_attestation",
      category: "entity",
      label: "SOS / business registry or borrower legal attestation",
      description: "Public registry record (secretary of state / business registry) or a borrower legal attestation confirming the entity.",
      required_for: "committee",
      baseStatus: ctx.registrySources.length > 0 ? "satisfied" : "open",
      evidence_basis: ctx.registrySources.length > 0 ? ["Registry source on file"] : [],
      recommended_action: "Attach a secretary-of-state / business-registry record or a borrower legal attestation.",
      acceptable_evidence: ["Secretary-of-state / business registry record", "Borrower-certified entity documents"],
      prevents_blockers: ["Stronger public/institutional sources required"],
      task: t((x) => x.task_type === "sos_business_registry"),
    }),
  );
  if ((input.dba ?? "").trim()) {
    optional.push(
      buildItem({
        key: "entity_dba",
        category: "entity",
        label: "DBA verification",
        description: "Verify any DBA / trade name used by the borrower.",
        required_for: "committee",
        baseStatus: "open",
        evidence_basis: [],
        recommended_action: "Attach evidence of the DBA / trade name registration.",
        acceptable_evidence: ["DBA registration", "Trade-name filing"],
        prevents_blockers: [],
        task: null,
      }),
    );
  }

  // 2. MANAGEMENT ───────────────────────────────────────────────────────────--
  const hasMgmt = (input.managementProfiles ?? []).length > 0;
  required.push(
    buildItem({
      key: "management_profile_and_role",
      category: "management",
      label: "Management profile + ownership/role evidence",
      description:
        "Management/ownership profile with role evidence. Banker-certified profile satisfies preliminary; committee needs public or attested verification + reviewer acceptance.",
      required_for: "both",
      // Profile on file → preliminary satisfied; committee verification still open.
      baseStatus: hasMgmt ? "preliminary_satisfied" : "open",
      evidence_basis: hasMgmt ? (input.managementProfiles ?? []).slice(0, 3).map((m) => m.person_name ?? "principal") : [],
      recommended_action:
        "Attach public/attested verification of the principal's role (registry officer listing, license, press, or borrower-certified attestation) and mark it analyst-accepted.",
      acceptable_evidence: [
        "Secretary-of-state officer listing",
        "Professional license / credential",
        "Borrower-signed management attestation / resume / PFS",
      ],
      prevents_blockers: ["Section needs committee-grade sources: Management Intelligence"],
      task: t((x) => x.task_type === "management_attestation"),
    }),
  );

  // 3. INDUSTRY / MARKET ────────────────────────────────────────────────────--
  required.push(
    buildItem({
      key: "industry_source",
      category: "industry",
      label: "Industry source",
      description: "Government / trade / market-research source supporting the industry analysis (from NAICS).",
      required_for: "committee",
      baseStatus: ctx.industrySources.length > 0 ? "satisfied" : "open",
      evidence_basis: ctx.industrySources.length > 0 ? ["Committee-grade industry source on file"] : [],
      recommended_action: `Attach a government/trade/market source for the industry${input.naicsCode ? ` (NAICS ${input.naicsCode})` : ""}.`,
      acceptable_evidence: ["BLS / Census industry data", "IBISWorld / Statista", "Recognized trade publication"],
      prevents_blockers: ["Section needs committee-grade sources: Industry Overview"],
      task: t((x) => x.task_type === "industry_market_source"),
    }),
  );
  required.push(
    buildItem({
      key: "market_geography_source",
      category: "market",
      label: "Market / geography source",
      description: "Official source supporting the local market / geography (from HQ city/state).",
      required_for: "committee",
      baseStatus: ctx.marketSources.length > 0 ? "satisfied" : "open",
      evidence_basis: ctx.marketSources.length > 0 ? ["Committee-grade market source on file"] : [],
      recommended_action: "Attach an official local-market source (BLS / Census / FRED / local economic-development).",
      acceptable_evidence: ["BLS / Census / FRED data", "Local government / economic-development source"],
      prevents_blockers: ["Section needs committee-grade sources: Market Intelligence"],
      task: t((x) => x.task_type === "industry_market_source"),
    }),
  );

  // 4. COMPETITIVE (only when competitors are named) ───────────────────────────
  const competitorsNamed = ctx.competitorRows.length > 0;
  if (competitorsNamed) {
    const base: RequirementStatus =
      ctx.competitorSourced.length > 0 ? "satisfied" : "needs_review";
    required.push(
      buildItem({
        key: "competitive_support",
        category: "competitive",
        label: "Competitive source support",
        description: "Verifiable source per named competitor, or an analyst-accepted/caveated status.",
        required_for: "committee",
        baseStatus: base,
        evidence_basis: ctx.competitorRows.slice(0, 4).map((r) => (r.claim ?? "competitor").slice(0, 60)),
        recommended_action: "Attach a source for each named competitor, or mark the competitive analysis analyst-accepted / caveated.",
        acceptable_evidence: ["Competitor website / press", "Trade publication naming competitors", "Analyst-accepted caveat"],
        prevents_blockers: ["Section needs committee-grade sources: Competitive Landscape"],
        task: t((x) => x.task_type === "competitive_source"),
        analystAcceptanceSatisfiesCommittee: true,
      }),
    );
  }

  // 5. FINANCIAL / EVIDENCE COVERAGE (from loan type) ─────────────────────────--
  required.push(
    buildItem({
      key: "dscr_spread_output",
      category: "financial",
      label: "DSCR / spread output",
      description: "Spread-based DSCR (global cash flow) supporting repayment.",
      required_for: "both",
      baseStatus: ctx.hasDscr ? "satisfied" : "open",
      evidence_basis: ctx.hasDscr ? ["DSCR / GCF_DSCR on file"] : [],
      recommended_action: "Produce the spread DSCR (run financial spreads).",
      acceptable_evidence: ["Spread-based DSCR", "Global cash flow DSCR"],
      prevents_blockers: ["Evidence coverage below committee threshold"],
      task: t((x) => x.task_type === "financial_file" && x.blocker_type === "evidence_coverage"),
    }),
  );
  required.push(
    buildItem({
      key: "financial_statements_or_tax",
      category: "financial",
      label: "Financial statements / tax returns",
      description: "Income statement / balance sheet or business/personal tax returns.",
      required_for: "both",
      baseStatus: ctx.financialDocs.length > 0 ? "satisfied" : "open",
      evidence_basis: ctx.financialDocs.slice(0, 4).map((d) => (d.canonical_type ?? d.document_type ?? "doc").toString()),
      recommended_action: "Attach financial statements or tax returns.",
      acceptable_evidence: ["Income statement / balance sheet", "Business or personal tax return"],
      prevents_blockers: ["Evidence coverage below committee threshold"],
      task: t((x) => x.task_type === "financial_file" && x.blocker_type === "evidence_coverage"),
    }),
  );
  required.push(
    buildItem({
      key: "loan_request_use_of_proceeds",
      category: "financial",
      label: "Loan request / use of proceeds",
      description: "Stated loan request and structured use of proceeds / term sheet.",
      required_for: "committee",
      baseStatus: input.hasStructuredLoanRequest ? "satisfied" : "open",
      evidence_basis: input.hasStructuredLoanRequest ? ["Structured loan request / use of proceeds on file"] : [],
      recommended_action: "Attach the loan request / term sheet and a structured use of proceeds.",
      acceptable_evidence: ["Loan request / term sheet", "Stated use of proceeds"],
      prevents_blockers: ["Evidence coverage below committee threshold"],
      task: null,
    }),
  );
  if (loan.collateralRelevant) {
    required.push(
      buildItem({
        key: "collateral_records",
        category: "collateral",
        label: "Collateral records",
        description: "Collateral documentation for the secured facility (AR aging / borrowing base, appraisal, schedule).",
        required_for: "committee",
        baseStatus: ctx.collateralDocs.length > 0 || ctx.hasArSupport ? "satisfied" : "open",
        evidence_basis: [
          ...ctx.collateralDocs.slice(0, 3).map((d) => (d.canonical_type ?? d.document_type ?? "doc").toString()),
          ...(ctx.hasArSupport ? ["AR support"] : []),
        ],
        recommended_action: "Attach collateral records (AR aging / borrowing base, appraisal, or collateral schedule).",
        acceptable_evidence: ["AR aging / borrowing base", "Appraisal / collateral schedule"],
        prevents_blockers: ["Evidence coverage below committee threshold"],
        task: null,
      }),
    );
  }
  if (loan.arConcentrationRelevant) {
    required.push(
      buildItem({
        key: "customer_concentration_ar_support",
        category: "financial",
        label: "Customer concentration / AR support",
        description: "Customer-concentration disclosure and AR support (relevant for LOC / working-capital facilities).",
        required_for: "committee",
        baseStatus: ctx.hasCustomerConcentration || ctx.hasArSupport ? "satisfied" : "open",
        evidence_basis: [
          ...(ctx.hasCustomerConcentration ? ["Customer concentration on file"] : []),
          ...(ctx.hasArSupport ? ["AR support on file"] : []),
        ],
        recommended_action: "Attach customer-concentration disclosure and AR support (aging / borrowing base).",
        acceptable_evidence: ["Customer concentration schedule", "AR aging / borrowing base"],
        prevents_blockers: ["Contradiction unresolved: scale plausibility"],
        task: null,
      }),
    );
  }

  // 6. SCALE PLAUSIBILITY (LOC / working-capital / large-client growth) ────────
  const scaleTask = t((x) => x.task_type === "financial_file" && x.blocker_type === "contradiction_gap");
  const scalePresent: string[] = [];
  const scaleMissing: string[] = [];
  if (ctx.hasRevenue) scalePresent.push("revenue_support");
  else scaleMissing.push("revenue_support");
  if (ctx.hasArSupport || ctx.hasCustomerConcentration) scalePresent.push("ar_customer_concentration_support");
  else scaleMissing.push("ar_customer_concentration_support");
  if (input.hasStructuredLoanRequest) scalePresent.push("use_of_proceeds_support");
  else scaleMissing.push("use_of_proceeds_support");
  // Capacity support is not derivable from the file alone.
  scaleMissing.push("capacity_support");
  // Analyst conclusion is always an explicit, required step (never auto-cleared).
  scaleMissing.push("analyst_conclusion");

  if (loan.scaleApplies) {
    // Scale is a contradiction check: never auto-clears, needs an analyst
    // conclusion. needs_review when there is some support, open otherwise.
    const scaleBase: RequirementStatus = scalePresent.length > 0 ? "needs_review" : "open";
    required.push(
      buildItem({
        key: "scale_plausibility_conclusion",
        category: "scale",
        label: "Scale plausibility — analyst conclusion",
        description:
          "Large-client growth / working-capital / LOC deal: revenue, capacity, AR/concentration and use-of-proceeds support plus an explicit analyst conclusion. Never auto-clears.",
        required_for: "committee",
        baseStatus: scaleBase,
        evidence_basis: scalePresent,
        recommended_action: "Document revenue + capacity + AR/concentration + use-of-proceeds support and record an explicit analyst scale-plausibility conclusion.",
        acceptable_evidence: [
          "Financial statements / tax returns confirming revenue scale",
          "Capacity / headcount documentation",
          "Customer concentration + AR support",
          "Analyst scale-plausibility conclusion",
        ],
        prevents_blockers: ["Contradiction unresolved: scale plausibility"],
        // Scale never auto-clears: a generic accept does NOT satisfy committee;
        // committee_grade is forbidden upstream, so it stays needs_review.
        task: scaleTask,
        analystAcceptanceSatisfiesCommittee: false,
      }),
    );
  }

  // 7. ADVERSE SCREEN (always) ─────────────────────────────────────────────────
  const adverseBase: RequirementStatus = ctx.adverseSources.length > 0 ? "needs_review" : "open";
  const adverseItem = buildItem({
    key: "adverse_screen",
    category: "adverse",
    label: "Public adverse-record screen",
    description: "Public adverse search (court / regulatory / lien / sanctions) with a result snapshot or reviewer attestation, plus stated limitations.",
    required_for: "committee",
    baseStatus: adverseBase,
    evidence_basis: ctx.adverseSources.length > 0 ? ["Adverse search result on file"] : [],
    recommended_action: "Run a public adverse-record screen and record the result snapshot, or attach an analyst adverse-screen attestation.",
    acceptable_evidence: [
      "PACER / court-record search result",
      "Regulatory / sanctions search (e.g. SAM.gov)",
      "Analyst-attested adverse-screen note",
    ],
    prevents_blockers: ["Section needs committee-grade sources: Litigation and Risk"],
    task: t((x) => x.task_type === "public_adverse_screen"),
  });
  required.push(adverseItem);

  // ── Derived outputs ──────────────────────────────────────────────────────--
  const committee_readiness_gaps: CommitteeReadinessGap[] = required
    .filter((i) => i.blocks_committee)
    .map((i) => ({
      key: i.key,
      category: i.category,
      label: i.label,
      status: i.status,
      prevents_blockers: i.prevents_blockers,
      recommended_action: i.recommended_action,
    }));

  const blocker_prevention_tasks: BlockerPreventionTask[] = required
    .filter((i) => i.status === "open" || i.status === "needs_review" || i.status === "preliminary_satisfied")
    .filter((i) => i.blocks_committee || i.blocks_preliminary)
    .map((i) => ({
      key: i.key,
      category: i.category,
      label: i.label,
      action: i.recommended_action,
      blocks_preliminary: i.blocks_preliminary,
      blocks_committee: i.blocks_committee,
      status: i.status,
    }));

  const byKey = (k: string) => required.find((i) => i.key === k);
  const source_collection_plan: SourceCollectionPlan = {
    items: [
      { key: "entity_website_snapshot", label: "Borrower official website", status: byKey("entity_website_snapshot")?.status ?? "open", collect: "auto_snapshot" },
      { key: "entity_sos_or_attestation", label: "SOS / business registry", status: byKey("entity_sos_or_attestation")?.status ?? "open", collect: "registry_or_attestation" },
      { key: "industry_source", label: "Industry source", status: byKey("industry_source")?.status ?? "open", collect: "gov_trade_market" },
      { key: "market_geography_source", label: "Market / geography source", status: byKey("market_geography_source")?.status ?? "open", collect: "gov_market" },
    ],
  };

  const attestation_plan: AttestationPlan = {
    items: [
      { key: "management_profile_and_role", label: "Management attestation", status: byKey("management_profile_and_role")?.status ?? "open", attestable_for: "preliminary" },
      { key: "entity_sos_or_attestation", label: "Borrower legal entity attestation", status: byKey("entity_sos_or_attestation")?.status ?? "open", attestable_for: "preliminary" },
    ],
  };

  const adverse_screen_plan: AdverseScreenPlan = {
    required: true,
    status: adverseItem.status,
    acceptable_evidence: adverseItem.acceptable_evidence,
    limitations:
      "A negative public-record search is not conclusive of no adverse history; record search scope/date and any analyst attestation.",
  };

  const scale_plausibility_plan: ScalePlausibilityPlan = {
    applicable: loan.scaleApplies,
    status: loan.scaleApplies ? byKey("scale_plausibility_conclusion")?.status ?? "open" : "satisfied",
    auto_clear_forbidden: true,
    required_supports: [
      "revenue_support",
      "capacity_support",
      "ar_customer_concentration_support",
      "use_of_proceeds_support",
      "analyst_conclusion",
    ],
    present_supports: loan.scaleApplies ? scalePresent : [],
    missing_supports: loan.scaleApplies ? scaleMissing : [],
    analyst_conclusion_required: loan.scaleApplies,
  };

  return {
    required_evidence_items: required,
    optional_evidence_items: optional,
    blocker_prevention_tasks,
    committee_readiness_gaps,
    source_collection_plan,
    attestation_plan,
    adverse_screen_plan,
    scale_plausibility_plan,
  };
}

/**
 * Completion Gate — deterministic trust evaluation for BIE research missions.
 *
 * A research mission is not "complete" just because the process finished.
 * It receives a trust grade based on measurable quality criteria.
 *
 * Trust grades:
 *   committee_grade        — meets all thresholds; safe for committee consumption
 *   preliminary            — meets minimum bar; suitable for internal use / initial review
 *   manual_review_required — significant gaps; human verification needed before committee
 *   research_failed        — critical failures; do not surface to banker without re-run
 */

import type { BIEResult, EntityLock, EntityClassification } from "./buddyIntelligenceEngine";
import {
  computeSourceQualityScore,
  classifySourceUrl,
  normalizeDomain,
  PRIMARY_INSTITUTIONAL_SOURCE_TYPES,
  type SourceType,
} from "./sourcePolicy";
import {
  evaluateSectionSourceStatuses,
  summarizeSectionStatuses,
  type SectionSourceStatus,
  type SectionSourceContext,
} from "./sectionSourceStatus";
import {
  buildContradictionChecklist,
  summarizeContradictionChecklist,
  type ContradictionCheck,
} from "./contradictionChecklist";
import {
  scoreEvidenceQuality,
  COMMITTEE_MIN_PUBLIC_QUALITY,
  COMMITTEE_COVERAGE_THRESHOLD,
  type EvidenceQualityResult,
  type EvidenceQualityInput,
} from "./evidenceQuality";

/**
 * SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 Phase 5/6: granular
 * loan-file/banker-certified evidence signals. The gate derives sensible
 * defaults from the entity/source flags it already has; runMission supplies the
 * richer subject/DB-derived signals (DSCR, statements, collateral, etc.).
 */
export type EvidenceSignals = Partial<
  Pick<
    EvidenceQualityInput,
    | "hasLegalName" | "hasWebsite" | "hasHqLocation" | "hasBankerIdentitySummary"
    | "hasNaics" | "hasIndustryDescription" | "hasBusinessDescription"
    | "hasProductsServices" | "hasCustomerAnchors" | "hasCompetitivePosition"
    | "hasRevenue" | "hasDscr" | "hasFinancialStatements"
    | "hasLoanRequest" | "hasCollateral" | "privateCompanyMode"
  >
>;

export type PreliminaryBasis =
  | "public_web"
  | "banker_certified_private_company"
  | "loan_file_evidence"
  | null;

export type TrustGrade =
  | "committee_grade"
  | "preliminary"
  | "manual_review_required"
  | "research_failed";

export type GateCheckResult = {
  gate_id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  reason: string;
  severity: "error" | "warn" | "info";
};

export type CompletionGateResult = {
  trust_grade: TrustGrade;
  gate_passed: boolean;
  quality_score: number;  // 0–100 computed score
  checks: GateCheckResult[];
  threads_succeeded: number;
  threads_failed: number;
  entity_confidence: number;
  principals_confirmed: number;
  principals_unconfirmed: number;
  source_count: number;
  source_quality_score: number;
  contradictions_found: number;
  underwriting_questions_found: number;
  // SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 Phase 3: per-section
  // preliminary-vs-committee source status (replaces the binary "X/6" figure).
  section_source_statuses: SectionSourceStatus[];
  // Phase 4: full 8-check adversarial contradiction checklist.
  contradiction_checklist: ContradictionCheck[];
  // Phase 5/6: evidence lanes + readiness semantics.
  evidence_quality: EvidenceQualityResult;
  preliminary_eligible: boolean;
  committee_eligible: boolean;
  preliminary_basis: PreliminaryBasis;
  committee_blockers: string[];
  evaluated_at: string;
};

// Thresholds for trust grade assignment
const THRESHOLDS = {
  committee_grade: {
    min_threads_succeeded: 4,
    min_entity_confidence: 0.70,
    min_source_count: 10,
    min_source_quality_score: 0.50,
    max_unconfirmed_principals_pct: 0.0,  // 0% — all principals must be confirmed
    require_synthesis: true,
    require_contradictions: true,
  },
  preliminary: {
    min_threads_succeeded: 3,
    min_entity_confidence: 0.50,
    min_source_count: 5,
    min_source_quality_score: 0.35,
    max_unconfirmed_principals_pct: 0.5,  // 50% unconfirmed still passes as preliminary
    require_synthesis: true,
    require_contradictions: false,
  },
};

export function evaluateCompletionGate(
  bieResult: BIEResult,
  missionId: string,
  opts?: {
    naicsCode?: string | null;
    /** Phase 82: evidence coverage ratio from latest memo (null when no memo exists yet) */
    evidenceSupportRatio?: number | null;
    /**
     * SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1: deterministic
     * entity disposition. `probable_private_entity` / `unconfirmed_needs_banker_identity`
     * downgrade the entity gate from error→warn (no false research_failed);
     * `conflicting_public_entity` / `wrong_entity_risk` keep the error.
     */
    entityClassification?: EntityClassification | null;
    /** Banker-certified evidence present — downgrades management/source gates for private borrowers. */
    bankerCertifiedEvidence?: {
      hasStory: boolean;
      hasManagement: boolean;
      hasFinancials: boolean;
    } | null;
    /**
     * SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 Phase 1: provenance of
     * the management thread. "fallback" = deterministic banker-certified/file-
     * based profile (no public verification) → management gate is a committee
     * blocker but never a hard research failure.
     */
    managementBasis?: "public_web" | "fallback" | null;
    /**
     * SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 Phase 2: borrower's own
     * website domain — lets source classification recognize the borrower's
     * official site (borrower_official_website) rather than dumping it in unknown.
     */
    borrowerDomain?: string | null;
    /** Phase 5/6: granular loan-file / banker-certified evidence signals. */
    evidenceSignals?: EvidenceSignals;
  },
): CompletionGateResult {
  const checks: GateCheckResult[] = [];

  // SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1
  const entityClassification = opts?.entityClassification ?? null;
  const isPrivateEntity = entityClassification === "probable_private_entity";
  const isUnconfirmedIdentity = entityClassification === "unconfirmed_needs_banker_identity";
  const isEntityConflict =
    entityClassification === "conflicting_public_entity" ||
    entityClassification === "wrong_entity_risk";
  const bankerCertified = opts?.bankerCertifiedEvidence ?? null;
  const hasBankerCertifiedManagement = !!bankerCertified?.hasManagement;
  const managementBasis = opts?.managementBasis ?? null;
  const managementIsFallback = managementBasis === "fallback";

  // ── Gate 0 (Phase 80): NAICS Placeholder Guard ──────────────────────────
  const naics = opts?.naicsCode ?? null;
  const naicsIsPlaceholder = !naics || naics === "999999";
  if (naicsIsPlaceholder) {
    checks.push({
      gate_id: "naics_guard",
      label: "Industry Classification",
      status: "warn",
      reason: naics === "999999"
        ? "NAICS 999999 (placeholder) — industry research may be unreliable. Max trust: preliminary."
        : "NAICS not provided — industry research may be unreliable.",
      severity: "warn",
    });
  }

  // ── Gate 1: Entity Lock ──────────────────────────────────────────────────
  const entityConfidence = bieResult.entity_lock?.entity_confidence ?? bieResult.entity_confidence ?? 0;

  // SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1: disposition-aware.
  // A banker-certified private borrower with limited public footprint, or one
  // simply missing a public search name, is NOT a wrong-entity failure.
  let entityStatus: "pass" | "warn" | "fail";
  let entitySeverity: "error" | "warn" | "info";
  let entityReason: string;
  if (isEntityConflict) {
    entityStatus = "fail";
    entitySeverity = "error";
    entityReason = `Conflicting/wrong public entity risk — research may cover the wrong company (${Math.round(entityConfidence * 100)}% confidence)`;
  } else if (isUnconfirmedIdentity) {
    entityStatus = "warn";
    entitySeverity = "warn";
    entityReason = "Entity not yet identifiable — provide legal borrower name / DBA / website in Memo Inputs to enable verification";
  } else if (isPrivateEntity) {
    entityStatus = "warn";
    entitySeverity = "warn";
    entityReason = `Probable private entity (${Math.round(entityConfidence * 100)}% confidence) — limited public footprint; banker-certified context on file. Not committee-grade without public confirmation.`;
  } else {
    entityStatus = entityConfidence >= 0.70 ? "pass" : entityConfidence >= 0.50 ? "warn" : "fail";
    entitySeverity = entityConfidence < 0.50 ? "error" : entityConfidence < 0.70 ? "warn" : "info";
    entityReason = entityConfidence >= 0.70
      ? `Entity confirmed: "${bieResult.entity_lock?.confirmed_name}" (${Math.round(entityConfidence * 100)}% confidence)`
      : entityConfidence >= 0.50
        ? `Entity partially confirmed (${Math.round(entityConfidence * 100)}% confidence) — manual verification recommended`
        : `Entity could not be confirmed (${Math.round(entityConfidence * 100)}% confidence) — research may cover wrong entity`;
  }

  checks.push({
    gate_id: "entity_lock",
    label: "Entity Identity Lock",
    status: entityStatus,
    reason: entityReason,
    severity: entitySeverity,
  });

  // ── Gate 2: Thread Coverage ───────────────────────────────────────────────
  const coreThreads = [
    bieResult.borrower,
    bieResult.management,
    bieResult.competitive,
    bieResult.market,
    bieResult.industry,
    bieResult.transaction,
  ];
  const threadsSucceeded = coreThreads.filter(Boolean).length;
  const threadsFailed = coreThreads.filter((t) => t === null).length;

  checks.push({
    gate_id: "thread_coverage",
    label: "Research Thread Coverage",
    status: threadsSucceeded >= 5 ? "pass" : threadsSucceeded >= 3 ? "warn" : "fail",
    reason: `${threadsSucceeded}/6 research threads completed${threadsFailed > 0 ? ` (${threadsFailed} failed: ${getMissingThreads(bieResult).join(", ")})` : ""}`,
    severity: threadsSucceeded < 3 ? "error" : threadsSucceeded < 5 ? "warn" : "info",
  });

  // ── Gate 3: Source Diversity ──────────────────────────────────────────────
  const borrowerDomain = normalizeDomain(opts?.borrowerDomain ?? null);
  const classifyOpts = { borrowerDomain };
  const allSourceUrls = bieResult.sources_used ?? [];
  const sourceQuality = computeSourceQualityScore(allSourceUrls, classifyOpts);
  const primaryInstitutional = new Set<SourceType>(PRIMARY_INSTITUTIONAL_SOURCE_TYPES);
  const primarySources = allSourceUrls.filter((url) =>
    primaryInstitutional.has(classifySourceUrl(url, classifyOpts)),
  ).length;

  // SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1: for a private/
  // banker-certified borrower, weak PUBLIC source coverage is expected and must
  // not force research_failed — downgrade the <5-sources error to a warning.
  const privateOrCertified = isPrivateEntity || isUnconfirmedIdentity || hasBankerCertifiedManagement;
  const sourceSeverity: "error" | "warn" | "info" =
    allSourceUrls.length < 5
      ? privateOrCertified ? "warn" : "error"
      : sourceQuality < 0.35 ? "warn" : "info";

  checks.push({
    gate_id: "source_diversity",
    label: "Source Quality and Diversity",
    status: sourceQuality >= 0.50 && allSourceUrls.length >= 10 ? "pass"
           : sourceQuality >= 0.35 && allSourceUrls.length >= 5 ? "warn" : "fail",
    reason: `${allSourceUrls.length} public sources (${primarySources} primary/institutional), quality score ${Math.round(sourceQuality * 100)}%`
      + (privateOrCertified && allSourceUrls.length < 5 ? " — limited public footprint expected for a private/banker-certified borrower" : ""),
    severity: sourceSeverity,
  });

  // ── Gate 4: Management Validation ────────────────────────────────────────
  const profiles = bieResult.management?.principal_profiles ?? [];
  const confirmedCount = profiles.filter((p) => p.identity_confirmed).length;
  const unconfirmedCount = profiles.filter((p) => !p.identity_confirmed).length;
  const mgmtValidated = bieResult.synthesis?.management_profiles_validated ?? false;

  // SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1: a banker-certified
  // principal (deal_management_profiles) who simply can't be PUBLICLY confirmed is
  // a warning, not a hard failure. Committee-grade still requires public/attested
  // confirmation (the committee-grade branch checks confirmedCount === profiles.length).
  // SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 Phase 1C/1D: a file-based
  // fallback profile (deterministic, from banker-certified principals) is a
  // committee blocker but NOT a hard failure — and must never produce the
  // "management research not possible" message when a profile exists.
  const mgmtUnvalidatedButCertified =
    profiles.length > 0 && !mgmtValidated && (hasBankerCertifiedManagement || managementIsFallback);
  const mgmtSeverity: "error" | "warn" | "info" =
    profiles.length > 0 && !mgmtValidated
      ? mgmtUnvalidatedButCertified ? "warn" : "error"
      : unconfirmedCount > profiles.length * 0.5 ? "warn" : "info";

  checks.push({
    gate_id: "management_validation",
    label: "Management Profile Validation",
    status: profiles.length === 0 ? "warn"
           : confirmedCount === profiles.length ? "pass"
           : mgmtUnvalidatedButCertified ? "warn"
           : unconfirmedCount <= profiles.length * 0.5 ? "warn" : "fail",
    reason: profiles.length === 0
      ? "No management profile on file yet — add principals/ownership in Memo Inputs to enable management verification"
      : managementIsFallback
        ? "Management profile is banker-certified/file-based; public confirmation limited."
        : mgmtUnvalidatedButCertified
          ? `${confirmedCount}/${profiles.length} principals publicly confirmed — banker-certified profile on file (not publicly verifiable)`
          : `${confirmedCount}/${profiles.length} principals confirmed; synthesis validation: ${mgmtValidated ? "passed" : "FAILED"}`,
    severity: mgmtSeverity,
  });

  // ── Gate 5: Synthesis Completion ─────────────────────────────────────────
  const synthesis = bieResult.synthesis;
  const contradictionsFound = synthesis?.contradictions_and_uncertainties?.length ?? 0;
  const questionsFound = synthesis?.underwriting_questions?.length ?? 0;

  checks.push({
    gate_id: "synthesis",
    label: "Credit Synthesis Completion",
    status: synthesis && synthesis.executive_credit_thesis ? "pass" : "fail",
    reason: synthesis
      ? `Synthesis complete — ${contradictionsFound} contradictions, ${questionsFound} underwriting questions identified`
      : "Synthesis thread failed — no credit thesis produced",
    severity: !synthesis ? "error" : "info",
  });

  // ── Gate 6: Entity Validation Pass ───────────────────────────────────────
  const entityValidationPassed = bieResult.synthesis?.entity_validation_passed ?? false;

  checks.push({
    gate_id: "entity_validation_pass",
    label: "Synthesis Entity Validation",
    status: entityValidationPassed ? "pass" : "warn",
    reason: entityValidationPassed
      ? "Synthesis confirmed research is about the correct entity"
      : "Synthesis entity validation not passed — content may reference wrong entity",
    severity: entityValidationPassed ? "info" : "warn",
  });

  // ── Gate 7 (Phase 79 → Phase 4): Contradiction Checklist ─────────────────
  // Deterministically emit all 8 adversarial checks. Each is "addressed"
  // (clear / flagged / insufficient_evidence); committee_blocker drives the
  // committee gate, not whether a contradiction was found.
  const contradictionChecklist = buildContradictionChecklist({
    contradictionsText: (bieResult.synthesis?.contradictions_and_uncertainties ?? []).join(" "),
    entityConflict: isEntityConflict,
    entityConfirmedPublicly:
      entityClassification === "confirmed_public_entity" && entityConfidence >= 0.70,
    hasBankerCertifiedIdentity: !!bankerCertified?.hasStory || isPrivateEntity,
    hasLegalIdentity: !!bankerCertified?.hasStory || entityConfidence > 0,
    managementBasis,
    managementProfileOnFile: profiles.length > 0,
    managementPubliclyConfirmed: confirmedCount > 0,
    hasBorrowerThread: !!bieResult.borrower,
    hasMarketThread: !!bieResult.market,
    hasIndustryThread: !!bieResult.industry,
    hasCompetitiveThread: !!bieResult.competitive,
    hasTransactionThread: !!bieResult.transaction,
    hasRevenue: !!bankerCertified?.hasFinancials,
    namedCompetitors: bieResult.competitive?.direct_competitors?.length ?? 0,
  });
  const contradictionSummary = summarizeContradictionChecklist(contradictionChecklist);
  const contradictionCommitteeBlockers = contradictionSummary.committeeBlockers.length;
  checks.push({
    gate_id: "contradiction_coverage",
    label: "Adversarial Contradiction Coverage",
    status: contradictionSummary.hasError ? "fail"
      : contradictionCommitteeBlockers === 0 ? "pass" : "warn",
    reason: `All ${contradictionSummary.total} adversarial checks addressed `
      + `(${contradictionSummary.flagged} flagged, ${contradictionSummary.insufficient} insufficient-evidence)`
      + (contradictionCommitteeBlockers > 0
          ? ` — committee blockers: ${contradictionSummary.committeeBlockers.join(", ")}`
          : ""),
    // Insufficient-evidence checks block committee but never force research_failed;
    // only a wrong/conflicting entity (error severity) is hard.
    severity: contradictionSummary.hasError ? "error" : "info",
  });

  // ── Gate 8 (Phase 81 → Phase 3): Section-Level Source Status ─────────────
  // Each section now carries a preliminary-vs-committee split. The gate check
  // reflects COMMITTEE readiness (institutional sources); preliminary readiness
  // is surfaced separately for the flight deck and memo readiness.
  const sectionStatuses = evaluateSectionSourceStatuses(
    buildSectionContext(bieResult, {
      classifyOpts,
      entityConflict: isEntityConflict,
      entityConfirmedPublicly:
        entityClassification === "confirmed_public_entity" && entityConfidence >= 0.70,
      hasBorrowerWebsiteOnFile: !!borrowerDomain,
      hasBankerStory: !!bankerCertified?.hasStory,
      hasIndustry: !naicsIsPlaceholder,
      managementBasis,
      profilesCount: profiles.length,
      managementPubliclyConfirmed: confirmedCount > 0,
    }),
  );
  const sectionSummary = summarizeSectionStatuses(sectionStatuses);
  const committeeDeficient = sectionSummary.committeeBlockers;
  checks.push({
    gate_id: "section_source_coverage",
    label: "Section-Level Source Requirements",
    status: committeeDeficient.length === 0 ? "pass" : committeeDeficient.length <= 3 ? "warn" : "fail",
    reason: committeeDeficient.length === 0
      ? `All ${sectionStatuses.length} sections meet committee source requirements`
      : `${sectionSummary.preliminaryReady}/${sectionStatuses.length} sections preliminary-ready; ` +
        `${sectionSummary.committeeReady}/${sectionStatuses.length} committee-ready — committee-deficient: ${committeeDeficient.join(", ")}`,
    // Committee-deficiency is a committee blocker, never a hard research failure.
    severity: committeeDeficient.length > 4 ? "warn" : "info",
  });

  // ── Gate 9 (Phase 82): Evidence Coverage Density ─────────────────────────
  // Only fires when a research trace exists (memo has been generated).
  // New deals with no memo are exempt — evidenceSupportRatio will be null.
  const evidenceRatio = opts?.evidenceSupportRatio ?? null;
  if (evidenceRatio !== null) {
    checks.push({
      gate_id: "evidence_coverage",
      label: "Evidence Coverage Density",
      status: evidenceRatio >= 0.85 ? "pass" : evidenceRatio >= 0.70 ? "warn" : "fail",
      reason: evidenceRatio >= 0.85
        ? `Strong evidence coverage — ${Math.round(evidenceRatio * 100)}% of sections backed by evidence`
        : evidenceRatio >= 0.70
          ? `Moderate evidence coverage (${Math.round(evidenceRatio * 100)}%) — 85% required for committee_grade`
          : `Weak evidence coverage — only ${Math.round(evidenceRatio * 100)}% of sections have evidence rows`,
      severity: evidenceRatio < 0.70 ? "warn" : "info",
    });
  }

  // ── Phase 5: Evidence Lanes ───────────────────────────────────────────────
  // Separate public-web quality from loan-file / banker-certified evidence so a
  // strong private-company file is not penalized for a thin public footprint.
  const entityConfirmedPublicly =
    entityClassification === "confirmed_public_entity" && entityConfidence >= 0.70;
  const sig = opts?.evidenceSignals ?? {};
  const evidence = scoreEvidenceQuality({
    entityConflict: isEntityConflict,
    entityLockConfirmedPublicly: entityConfirmedPublicly,
    hasLegalName: sig.hasLegalName ?? !!bankerCertified?.hasStory,
    hasWebsite: sig.hasWebsite ?? !!borrowerDomain,
    hasHqLocation: sig.hasHqLocation ?? false,
    hasBankerIdentitySummary: sig.hasBankerIdentitySummary ?? !!bankerCertified?.hasStory,
    hasNaics: sig.hasNaics ?? !naicsIsPlaceholder,
    hasIndustryDescription: sig.hasIndustryDescription ?? !!bieResult.industry,
    hasBusinessDescription: sig.hasBusinessDescription ?? !!bankerCertified?.hasStory,
    hasProductsServices: sig.hasProductsServices ?? false,
    hasCustomerAnchors: sig.hasCustomerAnchors ?? false,
    hasCompetitivePosition: sig.hasCompetitivePosition ?? !!bieResult.competitive,
    managementProfileOnFile: profiles.length > 0,
    managementPubliclyConfirmed: confirmedCount > 0,
    hasRevenue: sig.hasRevenue ?? !!bankerCertified?.hasFinancials,
    hasDscr: sig.hasDscr ?? false,
    hasFinancialStatements: sig.hasFinancialStatements ?? false,
    hasLoanRequest: sig.hasLoanRequest ?? false,
    hasCollateral: sig.hasCollateral ?? false,
    publicSourceCount: allSourceUrls.length,
    primaryInstitutionalCount: primarySources,
    publicQualityScore: sourceQuality,
    privateCompanyMode: sig.privateCompanyMode ?? (isPrivateEntity || managementIsFallback),
  });

  // ── Grade Assignment (Phase 6) ────────────────────────────────────────────
  const failCount = checks.filter((c) => c.status === "fail").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const errorChecks = checks.filter((c) => c.severity === "error");

  // committee structural conditions — institutional, public, validated.
  const committeeStructural =
    threadsSucceeded >= THRESHOLDS.committee_grade.min_threads_succeeded &&
    entityConfidence >= THRESHOLDS.committee_grade.min_entity_confidence &&
    allSourceUrls.length >= THRESHOLDS.committee_grade.min_source_count &&
    sourceQuality >= THRESHOLDS.committee_grade.min_source_quality_score &&
    (profiles.length === 0 || confirmedCount === profiles.length) &&
    !!synthesis &&
    entityValidationPassed &&
    !naicsIsPlaceholder &&
    (evidenceRatio === null || evidenceRatio >= 0.85) &&
    failCount === 0 &&
    warnCount <= 1;

  // Grade keys off SEVERITY, not raw "fail" status: a private borrower's thin
  // public footprint and committee-deficient sections are "fail" status but
  // non-error severity by design — they block committee, never preliminary.
  const errorCountIsEntity =
    errorChecks.length === 1 && errorChecks[0].gate_id === "entity_lock";

  let trustGrade: TrustGrade;
  if (errorChecks.length >= 2 || errorCountIsEntity) {
    // research_failed: wrong/conflicting entity, no subject, unrecoverable failure.
    trustGrade = "research_failed";
  } else if (committeeStructural && evidence.committee_eligible) {
    // committee_grade: every committee threshold met AND public/attested verified.
    trustGrade = "committee_grade";
  } else if (errorChecks.length >= 1) {
    // manual_review_required: a single hard (non-entity) error — e.g. missing synthesis.
    trustGrade = "manual_review_required";
  } else if (
    evidence.preliminary_eligible &&
    !!synthesis &&
    threadsSucceeded >= THRESHOLDS.preliminary.min_threads_succeeded &&
    entityConfidence >= THRESHOLDS.preliminary.min_entity_confidence
  ) {
    // preliminary: entity lock pass, no hard conflict, enough certified/file
    // evidence, synthesis exists. Public-web weakness alone does NOT block this.
    //
    // FIX (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P0-5 / SPEC-13.5-V12
    // deferred-findings Layer 3): THRESHOLDS.preliminary.min_entity_confidence
    // was declared in the table above but never actually read anywhere —
    // combined with entity_lock's "warn" (never "error") severity for
    // unconfirmed_needs_banker_identity regardless of confidence, an entity
    // that came back fully UNCONFIRMED at 0% confidence could still reach the
    // memo-eligible "preliminary" grade purely from self-reported/loan-file
    // evidence-coverage signals that don't require identity confirmation at
    // all. This is the most likely root cause of the "quality_score=0 /
    // gate_passed=false" mission the team flagged as needing investigation
    // (never filed as SPEC-13.6) — a mission with zero confirmed identity
    // that nonetheless doesn't clear this bar now correctly falls through to
    // manual_review_required instead of silently either scoring 0 or, worse,
    // reaching preliminary on unrelated evidence.
    trustGrade = "preliminary";
  } else {
    // manual_review_required: diagnostics/fallback used or evidence coverage low.
    trustGrade = "manual_review_required";
  }

  // ── Phase 6: Readiness semantics (preliminary basis + committee blockers) ──
  const preliminaryBasis: PreliminaryBasis =
    !evidence.preliminary_eligible || isEntityConflict
      ? null
      : entityConfirmedPublicly && evidence.public_web_quality_score >= COMMITTEE_MIN_PUBLIC_QUALITY
        ? "public_web"
        : evidence.private_company_evidence_mode
          ? "banker_certified_private_company"
          : "loan_file_evidence";

  const committeeBlockers: string[] = [];
  if (isEntityConflict) committeeBlockers.push("Resolve wrong/conflicting public entity");
  if (!entityConfirmedPublicly && !isEntityConflict) committeeBlockers.push("Public/attested entity verification required");
  if (managementIsFallback || confirmedCount === 0)
    committeeBlockers.push("Public/attested management verification + adverse screen required");
  if (evidence.public_web_quality_score < COMMITTEE_MIN_PUBLIC_QUALITY || primarySources < 2)
    committeeBlockers.push("Stronger public/institutional sources required");
  if (evidence.certified_evidence_coverage_score < COMMITTEE_COVERAGE_THRESHOLD)
    committeeBlockers.push("Evidence coverage below committee threshold");
  for (const s of committeeDeficient) committeeBlockers.push(`Section needs committee-grade sources: ${s}`);
  for (const k of contradictionSummary.committeeBlockers) committeeBlockers.push(`Contradiction check unresolved: ${k}`);
  const dedupedCommitteeBlockers = [...new Set(committeeBlockers)];

  // ── Quality Score (0–100) ─────────────────────────────────────────────────
  const qualityScore = computeQualityScore({
    entityConfidence,
    threadsSucceeded,
    sourceQuality,
    sourceCount: allSourceUrls.length,
    mgmtConfirmRate: profiles.length > 0 ? confirmedCount / profiles.length : 1.0,
    hasSynthesis: !!synthesis,
    contradictionsFound,
    entityValidationPassed,
    warnCount,
    failCount,
  });

  return {
    trust_grade: trustGrade,
    gate_passed: ["committee_grade", "preliminary"].includes(trustGrade),
    quality_score: qualityScore,
    checks,
    threads_succeeded: threadsSucceeded,
    threads_failed: threadsFailed,
    entity_confidence: entityConfidence,
    principals_confirmed: confirmedCount,
    principals_unconfirmed: unconfirmedCount,
    source_count: allSourceUrls.length,
    source_quality_score: sourceQuality,
    contradictions_found: contradictionsFound,
    underwriting_questions_found: questionsFound,
    section_source_statuses: sectionStatuses,
    contradiction_checklist: contradictionChecklist,
    evidence_quality: evidence,
    preliminary_eligible: evidence.preliminary_eligible,
    committee_eligible: evidence.committee_eligible && committeeStructural,
    preliminary_basis: preliminaryBasis,
    committee_blockers: dedupedCommitteeBlockers,
    evaluated_at: new Date().toISOString(),
  };
}

/**
 * Build the Phase 3 section-source context from a BIE result + derived flags.
 */
function buildSectionContext(
  bieResult: BIEResult,
  args: {
    classifyOpts: { borrowerDomain: string | null };
    entityConflict: boolean;
    entityConfirmedPublicly: boolean;
    hasBorrowerWebsiteOnFile: boolean;
    hasBankerStory: boolean;
    hasIndustry: boolean;
    managementBasis: "public_web" | "fallback" | null;
    profilesCount: number;
    managementPubliclyConfirmed: boolean;
  },
): SectionSourceContext {
  const allUrls = bieResult.sources_used ?? [];
  const sourceTypes = new Set<SourceType>(
    allUrls.map((u) => classifySourceUrl(u, args.classifyOpts)),
  );
  return {
    sourceTypes,
    entityConflict: args.entityConflict,
    entityConfirmedPublicly: args.entityConfirmedPublicly,
    hasBorrowerOfficialSource: sourceTypes.has("borrower_official_website"),
    hasBorrowerWebsiteOnFile: args.hasBorrowerWebsiteOnFile,
    hasBankerStory: args.hasBankerStory,
    // hasStory is set from the presence of a banker-certified business description.
    hasBusinessDescription: args.hasBankerStory,
    hasIndustry: args.hasIndustry || !!bieResult.industry,
    managementProfileOnFile: args.profilesCount > 0,
    managementBasis: args.managementBasis,
    managementPubliclyConfirmed: args.managementPubliclyConfirmed,
    // The borrower thread performs the litigation/adverse search.
    adverseSearchAttempted: !!bieResult.borrower,
    // Conservative: we do not infer a public adverse finding deterministically.
    adverseFindingPublic: false,
    namedCompetitors: bieResult.competitive?.direct_competitors?.length ?? 0,
  };
}

function getMissingThreads(result: BIEResult): string[] {
  const missing: string[] = [];
  if (!result.borrower) missing.push("borrower");
  if (!result.management) missing.push("management");
  if (!result.competitive) missing.push("competitive");
  if (!result.market) missing.push("market");
  if (!result.industry) missing.push("industry");
  if (!result.transaction) missing.push("transaction");
  return missing;
}

function computeQualityScore(params: {
  entityConfidence: number;
  threadsSucceeded: number;
  sourceQuality: number;
  sourceCount: number;
  mgmtConfirmRate: number;
  hasSynthesis: boolean;
  contradictionsFound: number;
  entityValidationPassed: boolean;
  warnCount: number;
  failCount: number;
}): number {
  let score = 0;
  score += params.entityConfidence * 20;          // max 20
  score += Math.min(params.threadsSucceeded / 6, 1) * 20;  // max 20
  score += params.sourceQuality * 15;              // max 15
  score += Math.min(params.sourceCount / 20, 1) * 10;  // max 10
  score += params.mgmtConfirmRate * 15;            // max 15
  score += params.hasSynthesis ? 10 : 0;           // 10
  score += Math.min(params.contradictionsFound, 3) * 2;  // max 6 (reward adversarial)
  score += params.entityValidationPassed ? 4 : 0;  // 4
  score -= params.warnCount * 2;
  score -= params.failCount * 8;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// Phase 79's regex-only contradiction coverage and Phase 82's strength scoring
// were replaced in Phase 4 by the always-emitted structured checklist in
// contradictionChecklist.ts (see Gate 7 above). Phase 81's binary section
// coverage was replaced in Phase 3 by the preliminary-vs-committee split in
// sectionSourceStatus.ts (see Gate 8 above).
//
// Backwards-compatible re-exports for any external importer.
export { REQUIRED_CONTRADICTION_CHECKS } from "./contradictionChecklist";
export type { ContradictionCheckKey } from "./contradictionChecklist";

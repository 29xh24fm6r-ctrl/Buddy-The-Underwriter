/**
 * SPEC-BIE-INSTITUTIONAL-DECISION-NARRATIVES-1
 *
 * Pure, deterministic builder that turns the existing committee/BIE snapshot data
 * into an institutional underwriting DECISION NARRATIVE per decision card:
 * a conclusion, a recommendation, a confidence level, key findings, the evidence
 * used (with strength), evidence gaps, and risk notes.
 *
 * No DB / network / AI calls. No fabricated facts — every finding is derived from
 * data already on the snapshot (blocker resolutions, requirements plan, captured
 * sources, the already-banker-ized group evidence + decision support). Names /
 * NAICS appear ONLY when present in the evidence. NEVER changes gate / scoring /
 * lifecycle / persistence; it only re-projects what Buddy already knows.
 */

import type { CommitteeBlockerResolution } from "@/lib/research/committeeBlockerResolution";
import type { CommitteeRequirementsPlan } from "@/lib/research/committeeRequirementsEngine";
import type {
  DecisionEvidenceProjection,
  DecisionEvidenceFactor,
  EvidenceClass,
} from "@/lib/research/committeeEvidenceProjection";
import type {
  CommitteeReadinessGroupId,
  CommitteeReadinessGroupView,
  DecisionSupport,
} from "./committeeReadinessView";

/** SPEC-…-EVIDENCE-PROMOTION-1 (L): banker-facing label for an evidence class. */
export const EVIDENCE_CLASS_LABEL: Record<EvidenceClass, string> = {
  missing: "Missing",
  borrower_supported: "Borrower-supported",
  file_supported: "File-supported",
  public_supported: "Public source",
  official_supported: "Official",
  banker_attested: "Banker-attested",
  committee_grade: "Committee-ready",
  contradicted: "Contradicted",
  not_derivable: "Not derivable",
};

export interface ConfidenceDrivers {
  positive: string[];
  negative: string[];
  neutral: string[];
}

export type DecisionRecommendation =
  | "Approve"
  | "Approve with caveat"
  | "Request more support"
  | "Escalate"
  | "Unable to conclude";

export type DecisionConfidence = "High" | "Medium" | "Low";

export interface DecisionEvidenceItem {
  label: string;
  sourceType?: string;
  sourceUrl?: string;
  officialCaptureStatus?: string;
  strength: "Strong" | "Moderate" | "Weak";
  /** SPEC-…-EVIDENCE-PROMOTION-1 (L): evidence class for the badge, when known. */
  evidenceClass?: EvidenceClass;
}

export interface InstitutionalDecisionNarrative {
  domain: string;
  conclusion: string;
  recommendation: DecisionRecommendation;
  confidence: DecisionConfidence;
  keyFindings: string[];
  evidenceUsed: DecisionEvidenceItem[];
  evidenceGaps: string[];
  riskNotes: string[];
  bankerGuidance: string;
  // SPEC-…-EVIDENCE-PROMOTION-1 (K/L)
  /** Why confidence is what it is — never empty when a badge shows. */
  confidenceDrivers: ConfidenceDrivers;
  /** Why this recommendation. */
  recommendationDrivers: string[];
  /** Classified factor breakdown (Business Scale's six factors), when available. */
  factors: DecisionEvidenceFactor[];
}

const GROUP_DOMAIN: Record<CommitteeReadinessGroupId, string> = {
  entity: "Business Verification",
  risk: "Public Records Review",
  management: "Management Quality",
  financial: "Loan & Repayment Support",
  industry: "Industry Validation",
  scale: "Business Scale",
};

// ── small pure helpers ────────────────────────────────────────────────────────

function clip(s: string, n = 120): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Captured-source evidence + the blocker's own supporting-claim previews. */
function evidenceFromGroup(
  group: CommitteeReadinessGroupView,
  blockers: CommitteeBlockerResolution[],
): DecisionEvidenceItem[] {
  const out: DecisionEvidenceItem[] = [];
  for (const s of group.capturedSources) {
    out.push({
      label: s.label,
      sourceUrl: s.officialCaptureUrl ?? s.receiptUrl,
      officialCaptureStatus: s.officialCaptureStatus,
      strength: s.officialCaptureUrl ? "Strong" : "Weak",
    });
  }
  for (const b of blockers) {
    for (const e of b.existing_supporting_evidence ?? []) {
      if (!e.claim_preview) continue;
      out.push({
        label: clip(e.claim_preview),
        sourceType: e.evidence_type ?? e.section ?? undefined,
        strength: typeof e.confidence === "number" && e.confidence >= 0.7 ? "Strong" : "Moderate",
      });
    }
  }
  // De-dupe by label, cap.
  const seen = new Set<string>();
  return out.filter((i) => (seen.has(i.label.toLowerCase()) ? false : (seen.add(i.label.toLowerCase()), true))).slice(0, 6);
}

/** Best-effort NAICS extraction from any blocker text — never fabricated. */
function findNaics(blockers: CommitteeBlockerResolution[]): { code: string; desc: string | null } | null {
  for (const b of blockers) {
    const hay = [b.title, ...(b.missing_evidence ?? []), ...(b.existing_supporting_evidence ?? []).map((e) => e.claim_preview ?? "")].join(" ");
    const m = /\b(\d{6})\b(?:\s*[—:-]\s*([^.;]+))?/.exec(hay);
    if (m) return { code: m[1], desc: m[2] ? clip(m[2], 60) : null };
  }
  return null;
}

/**
 * SPEC-SCALE-PLAUSIBILITY-RECONCILIATION-1 / FINAL-CARD-CAP-1: cap a Business Scale
 * narrative when the gate still flags scale_plausibility. Applied at the final
 * card-model boundary so it holds regardless of which path produced the narrative
 * (evidence-backed, legacy fallback, or a payload missing the projection field).
 * Verdict only — evidence factors are never downgraded. Idempotent.
 */
export function applyScaleConclusionCap(n: InstitutionalDecisionNarrative): InstitutionalDecisionNarrative {
  const driver = "Analyst scale-plausibility conclusion still required";
  const recommendation: DecisionRecommendation = n.recommendation === "Approve" ? "Approve with caveat" : n.recommendation;
  const confidence: DecisionConfidence = n.confidence === "High" ? "Medium" : n.confidence;
  const negative = n.confidenceDrivers.negative.includes(driver)
    ? n.confidenceDrivers.negative
    : [...n.confidenceDrivers.negative, driver];
  const conclusion = /analyst scale-plausibility conclusion is still required/i.test(n.conclusion)
    ? n.conclusion
    : "Scale appears supported by file evidence, but an analyst scale-plausibility conclusion is still required before committee readiness.";
  return { ...n, recommendation, confidence, conclusion, confidenceDrivers: { ...n.confidenceDrivers, negative } };
}

// ── per-decision narratives ───────────────────────────────────────────────────

export function buildDecisionNarrative(
  groupId: CommitteeReadinessGroupId,
  group: CommitteeReadinessGroupView,
  blockers: CommitteeBlockerResolution[],
  support: DecisionSupport,
  plan: CommitteeRequirementsPlan | null,
  evidence: DecisionEvidenceProjection | null = null,
): InstitutionalDecisionNarrative {
  const domain = GROUP_DOMAIN[groupId];
  const complete = group.status === "Complete";
  const hasCaptured = group.capturedSources.length > 0;
  const hasOfficial = group.capturedSources.some((s) => !!s.officialCaptureUrl);
  const hasReceiptOnly = group.capturedSources.some((s) => !s.officialCaptureUrl);
  const hasSearchFormOnly = group.capturedSources.some((s) => s.officialCaptureStatus === "search_form_only");
  const evidenceUsed = evidenceFromGroup(group, blockers);
  const evidenceGaps = support.evidenceMissing.slice(0, 6);
  const riskNotes: string[] = [...support.sourceLimitations];
  const findingRecorded = blockers.some((b) =>
    (b.evidence_tasks ?? []).some((t) => /finding/i.test(String(t.review_reason ?? ""))),
  );
  // A research contradiction outside the scale group is a committee risk to flag.
  if (groupId !== "scale" && blockers.some((b) => b.blocker_type === "contradiction_gap")) {
    riskNotes.push("Unresolved research contradiction flagged — review before committee.");
  }
  void plan; // accepted as input per spec; current narratives derive from support + blockers
  // Default drivers (legacy / no-projection path) — never leave confidence
  // unexplained (K). Evidence-backed branches override with precise drivers.
  const positive = evidenceUsed.map((e) => e.label).slice(0, 4);
  const negative = evidenceGaps.slice(0, 4);
  const defaultDrivers: ConfidenceDrivers = {
    positive,
    negative,
    neutral: positive.length === 0 && negative.length === 0 ? ["Based on the committee evidence available"] : [],
  };
  const base = {
    domain,
    evidenceUsed,
    evidenceGaps,
    riskNotes,
    bankerGuidance: support.bankerGuidance,
    confidenceDrivers: defaultDrivers,
    recommendationDrivers: [] as string[],
    factors: [] as DecisionEvidenceFactor[],
  };

  // SPEC-…-EVIDENCE-PROMOTION-1 (PR-B): when the classified evidence projection is
  // available, derive Scale / Industry / Management / Public-Records narratives
  // from the PROMOTED evidence (file/borrower/official classes) instead of the
  // blocker fallback — so real support is no longer reported as "missing".
  if (evidence) {
    if (groupId === "scale") return scaleFromEvidence(evidence, base);
    if (groupId === "industry") return industryFromEvidence(evidence, base);
    if (groupId === "management") return managementFromEvidence(evidence, base);
    if (groupId === "risk") return riskFromEvidence(evidence, base, findingRecorded);
  }

  switch (groupId) {
    case "risk": {
      const keyFindings = [
        `Adverse-screen result: ${complete ? "recorded" : "not yet recorded"}`,
        `Source captured: ${hasCaptured ? "yes" : "no"}`,
        `Official capture: ${hasOfficial ? "yes" : "no"}`,
        hasReceiptOnly ? "Buddy receipt only: yes (internal receipt — not official evidence)" : null,
        hasSearchFormOnly ? "Search limitation: search form only — official result page not captured" : null,
      ].filter((x): x is string => !!x);
      const recommendation: DecisionRecommendation = findingRecorded
        ? "Escalate"
        : complete
          ? "Approve"
          : "Request more support";
      const confidence: DecisionConfidence = complete && (hasOfficial || !hasCaptured)
        ? "High"
        : hasCaptured
          ? "Medium"
          : "Low";
      const conclusion = findingRecorded
        ? "A public-record finding has been recorded and must be reviewed before committee."
        : complete
          ? "A public-record / adverse-screen result is on file; no unresolved adverse finding blocks committee."
          : "No adverse public-record finding has been confirmed, but committee readiness requires a recorded adverse-screen result.";
      return { ...base, conclusion, recommendation, confidence, keyFindings };
    }

    case "management": {
      const meaningful = evidenceUsed.length > 0 || support.evidenceFound.length > 0;
      // Surface the ACTUAL supporting claims (e.g. named principals), not generic
      // "Research support for Management Intelligence" section labels.
      const keyFindings = [
        ...evidenceUsed.map((e) => e.label).slice(0, 3),
        `Independent role / experience support: ${hasOfficial ? "present" : "missing"}`,
      ];
      const recommendation: DecisionRecommendation = !meaningful
        ? "Request more support"
        : group.reviewableTasks.length > 0 || hasOfficial
          ? "Approve with caveat"
          : "Approve with caveat";
      const confidence: DecisionConfidence = hasOfficial ? "High" : meaningful ? "Medium" : "Low";
      const conclusion = meaningful
        ? "Management support is on file for preliminary review but is not yet independently verified for committee."
        : "No management support is on file; committee needs management evidence before a decision.";
      return { ...base, conclusion, recommendation, confidence, keyFindings };
    }

    case "industry": {
      const naics = findNaics(blockers);
      const hasSource = hasCaptured || support.evidenceFound.length > 0;
      const keyFindings = [
        naics ? `NAICS: ${naics.code}${naics.desc ? ` — ${naics.desc}` : ""}` : "NAICS / industry code: not available on this surface",
        `Independent industry source: ${hasSource ? "present" : "missing"}`,
        `Market / geography source: ${hasOfficial ? "present" : "missing"}`,
      ];
      if (!naics) evidenceGaps.unshift("No NAICS / industry code");
      const recommendation: DecisionRecommendation = hasSource ? "Approve with caveat" : "Request more support";
      const confidence: DecisionConfidence = naics && hasSource && hasOfficial ? "High" : hasSource ? "Medium" : "Low";
      const conclusion = hasSource
        ? "Industry support is partially on file; recognized market / competitor coverage may still be thin."
        : "Industry position rests on borrower-provided claims; no recognized independent industry source is on file.";
      return { ...base, conclusion, recommendation, confidence, keyFindings };
    }

    case "scale": {
      const checklist = support.scaleChecklist;
      const supported = checklist.filter((c) => c.present);
      const isRevenue = (l: string) => /revenue/i.test(l);
      const isUseOfProceeds = (l: string) => /use-of-proceeds|loan request/i.test(l);
      const revenueOk = checklist.some((c) => isRevenue(c.label) && c.present);
      const useOfProceedsOk = checklist.some((c) => isUseOfProceeds(c.label) && c.present);
      const keyFindings = checklist.map((c) => `${c.label}: ${c.present ? "Supported" : "Missing"}`);
      for (const c of checklist) if (!c.present && !evidenceGaps.includes(c.label)) evidenceGaps.push(c.label);
      const recommendation: DecisionRecommendation = !revenueOk || !useOfProceedsOk
        ? "Unable to conclude"
        : supported.length >= 5
          ? "Approve"
          : supported.length >= 3
            ? "Approve with caveat"
            : "Request more support";
      const confidence: DecisionConfidence = supported.length >= checklist.length
        ? "High"
        : revenueOk && useOfProceedsOk && supported.length >= 3
          ? "Medium"
          : "Low";
      const conclusion = !revenueOk || !useOfProceedsOk
        ? "Buddy cannot conclude on scale: core revenue or loan-request support is missing."
        : supported.length >= 5
          ? "Scale appears reasonable — revenue, request, capacity, collateral, and industry context are supported and consistent."
          : "Scale is partially supported; the missing factors below need explanation before committee.";
      return { ...base, conclusion, recommendation, confidence, keyFindings };
    }

    case "entity": {
      const keyFindings = [
        `Official entity record: ${hasOfficial ? "on file" : "not confirmed"}`,
        hasSearchFormOnly ? "Captured page is a registry search form, not the entity record" : null,
        ...support.evidenceFound.slice(0, 2),
      ].filter((x): x is string => !!x);
      const recommendation: DecisionRecommendation = hasOfficial ? "Approve" : hasCaptured ? "Approve with caveat" : "Request more support";
      const confidence: DecisionConfidence = hasOfficial ? "High" : hasCaptured ? "Medium" : "Low";
      const conclusion = hasOfficial
        ? "An official public/registry record confirms the borrowing entity."
        : "The borrowing entity is not yet confirmed by an official public record.";
      return { ...base, conclusion, recommendation, confidence, keyFindings };
    }

    case "financial":
    default: {
      const meaningful = support.evidenceFound.length > 0;
      const keyFindings = [
        ...support.evidenceFound.slice(0, 3),
        ...support.evidenceMissing.slice(0, 2).map((m) => `Missing: ${m}`),
      ];
      const recommendation: DecisionRecommendation = !meaningful ? "Request more support" : "Approve with caveat";
      const confidence: DecisionConfidence = meaningful ? "Medium" : "Low";
      const conclusion = meaningful
        ? "Loan request and repayment support are partially on file; remaining items are listed below."
        : "Committee needs the loan request, use of proceeds, and repayment / collateral support.";
      return { ...base, conclusion, recommendation, confidence, keyFindings };
    }
  }
}

// ── evidence-backed narratives (PR-B: consume the classified projection) ────────

type NarrativeBase = Omit<InstitutionalDecisionNarrative, "conclusion" | "recommendation" | "confidence" | "keyFindings">;

function strengthFromClass(cls: EvidenceClass): DecisionEvidenceItem["strength"] {
  if (cls === "file_supported" || cls === "official_supported" || cls === "committee_grade") return "Strong";
  if (cls === "public_supported" || cls === "borrower_supported" || cls === "banker_attested") return "Moderate";
  return "Weak";
}
function itemFromFactor(f: DecisionEvidenceFactor): DecisionEvidenceItem {
  return { label: f.label, strength: strengthFromClass(f.evidenceClass), evidenceClass: f.evidenceClass };
}
const truthy = (xs: Array<string | null | undefined>): string[] => xs.filter((x): x is string => !!x);
function adverseStatusLabel(s: string): string {
  if (s === "official_captured") return "official source captured";
  if (s === "manual_clear_attested") return "banker-attested clear (manual, not official)";
  if (s === "search_form_only") return "search form only — not official";
  return "not yet run";
}

function scaleFromEvidence(evidence: DecisionEvidenceProjection, base: NarrativeBase): InstitutionalDecisionNarrative {
  const factors = evidence.scaleFactors;
  const supported = factors.filter((f) => f.status === "Supported");
  const partial = factors.filter((f) => f.status === "Partially supported");
  const find = (re: RegExp) => factors.find((f) => re.test(f.factor));
  const revenueMissing = find(/revenue/i)?.status === "Missing";
  const loanMissing = find(/loan request/i)?.status === "Missing";
  const contradicted = factors.some((f) => f.status === "Contradicted");

  let recommendation: DecisionRecommendation = contradicted
    ? "Escalate"
    : revenueMissing || loanMissing
      ? "Unable to conclude"
      : supported.length >= 5
        ? "Approve"
        : supported.length >= 3
          ? "Approve with caveat"
          : "Request more support";
  let confidence: DecisionConfidence = contradicted || revenueMissing || loanMissing
    ? "Low"
    : supported.length >= 5
      ? "High"
      : supported.length >= 3
        ? "Medium"
        : "Low";

  // SPEC-SCALE-PLAUSIBILITY-RECONCILIATION-1: Business Scale must not read
  // "Approve / High" while the latest quality gate still flags scale_plausibility
  // as an unresolved committee blocker (gate-derived — not a committee task). The
  // evidence can support scale, but the verdict is capped until an analyst records
  // the scale-plausibility conclusion. Evidence factors are NOT downgraded.
  const conclusionPending = evidence.scalePlausibilityUnresolved;
  if (conclusionPending && recommendation === "Approve") recommendation = "Approve with caveat";
  if (conclusionPending && confidence === "High") confidence = "Medium";

  const keyFindings = factors.map((f) => {
    const tag = f.evidenceClass !== "missing" && f.evidenceClass !== "not_derivable" ? ` (${EVIDENCE_CLASS_LABEL[f.evidenceClass]})` : "";
    return `${f.factor}: ${f.status}${tag}`;
  });
  const conclusion = contradicted
    ? "Scale factors conflict — escalate before committee."
    : revenueMissing || loanMissing
      ? "Buddy cannot conclude on scale yet: core revenue or loan-request support is missing." + (conclusionPending ? " An analyst scale-plausibility conclusion is also still required." : "")
      : conclusionPending
        ? "Scale appears supported by file evidence, but an analyst scale-plausibility conclusion is still required before committee readiness."
        : supported.length >= 5
          ? "Scale appears reasonable — revenue, request, capacity, collateral, and industry context are supported and consistent."
          : `Scale is supported by ${supported.length} of ${factors.length} factors; the remaining factors rest on borrower narrative or are still missing.`;
  const confidenceDrivers: ConfidenceDrivers = {
    positive: [...supported, ...partial].map((f) => `${f.factor} — ${EVIDENCE_CLASS_LABEL[f.evidenceClass]}`),
    negative: [
      ...factors.filter((f) => f.status === "Missing" || f.status === "Not derivable").map((f) => `${f.factor}: ${f.status.toLowerCase()}`),
      ...(conclusionPending ? ["Analyst scale-plausibility conclusion still required"] : []),
    ],
    neutral: [],
  };
  const recommendationDrivers = [`${recommendation}: ${supported.length} of ${factors.length} scale factors supported${partial.length ? `, ${partial.length} partially` : ""}${conclusionPending ? "; analyst conclusion still required" : ""}.`];
  return {
    ...base,
    conclusion,
    recommendation,
    confidence,
    keyFindings,
    factors,
    evidenceUsed: factors.filter((f) => f.status !== "Missing").map(itemFromFactor),
    evidenceGaps: factors.filter((f) => f.status === "Missing" || f.status === "Not derivable").map((f) => f.label),
    confidenceDrivers,
    recommendationDrivers,
  };
}

function industryFromEvidence(evidence: DecisionEvidenceProjection, base: NarrativeBase): InstitutionalDecisionNarrative {
  const { understanding, independentSource, naicsCode, naicsDescription } = evidence.industry;
  const understood = understanding.status === "Supported";
  const hasSource = independentSource.status === "Supported";
  const keyFindings = [
    naicsCode ? `NAICS: ${naicsCode}${naicsDescription ? ` — ${naicsDescription}` : ""}` : "NAICS / industry code: not on file",
    `Industry understanding: ${understanding.status}`,
    `Independent committee-grade source: ${hasSource ? "present" : "missing"}`,
  ];
  const recommendation: DecisionRecommendation = hasSource ? "Approve with caveat" : "Request more support";
  const confidence: DecisionConfidence = hasSource ? "Medium" : "Low";
  const privateNote = evidence.privateCompanyEvidenceMode
    ? " (limited independent source is expected for a private borrower; file / banker evidence supports preliminary underwriting)"
    : "";
  const conclusion = `Buddy understands the borrower's industry from ${naicsCode ? `NAICS ${naicsCode} and ` : ""}the borrower story; ${hasSource ? "an independent committee-grade industry/market source is on file." : `an independent committee-grade industry/market source is still missing${privateNote}.`}`;
  const confidenceDrivers: ConfidenceDrivers = {
    positive: truthy([understood ? understanding.label : null]),
    negative: truthy([hasSource ? null : independentSource.reason]),
    neutral: [],
  };
  const recommendationDrivers = [
    hasSource
      ? "Approve with caveat: NAICS + borrower understanding with an independent source on file."
      : "Request more support: industry is understood from the file, but no recognized independent source (BLS/Census/FRED/IBISWorld/Statista/trade) is on file.",
  ];
  return {
    ...base,
    conclusion,
    recommendation,
    confidence,
    keyFindings,
    evidenceUsed: [understanding, independentSource].filter((f) => f.status !== "Missing").map(itemFromFactor),
    evidenceGaps: hasSource ? [] : ["Independent committee-grade industry / market source"],
    confidenceDrivers,
    recommendationDrivers,
  };
}

function managementFromEvidence(evidence: DecisionEvidenceProjection, base: NarrativeBase): InstitutionalDecisionNarrative {
  const { principals, profilePresent, publicVerification, adverseStatus } = evidence.management;
  const named = principals.length > 0;
  const keyFindings = [
    ...principals.slice(0, 3).map((p) => (p.title ? `${p.name} — ${p.title}` : p.name)),
    `Management profile: ${profilePresent ? "on file" : "missing"}`,
    `Public verification: ${publicVerification ? "present" : "limited"}`,
    `Adverse screen: ${adverseStatusLabel(adverseStatus)}`,
  ];
  const recommendation: DecisionRecommendation = !named ? "Request more support" : "Approve with caveat";
  const confidence: DecisionConfidence = !named ? "Low" : publicVerification && adverseStatus === "official_captured" ? "High" : "Medium";
  const conclusion = named
    ? `${principals[0].name}${principals[0].title ? ` (${principals[0].title})` : ""} is confirmed with a management profile on file; independent committee verification ${publicVerification ? "is present but limited" : "is still needed"}.`
    : "No named principal or management support is on file; committee needs management evidence before a decision.";
  const confidenceDrivers: ConfidenceDrivers = {
    positive: truthy([named ? "Principal confirmed" : null, profilePresent ? "Management profile on file" : null, publicVerification ? "Public verification present" : null]),
    negative: truthy([publicVerification ? null : "Independent / attested committee support limited", adverseStatus === "official_captured" ? null : "Adverse screen manual rather than official"]),
    neutral: [],
  };
  const recommendationDrivers = [
    named
      ? "Approve with caveat: principal confirmed and profile on file, but independent committee support remains limited."
      : "Request more support: no named principal or meaningful management support on file.",
  ];
  return { ...base, conclusion, recommendation, confidence, keyFindings, confidenceDrivers, recommendationDrivers };
}

function riskFromEvidence(evidence: DecisionEvidenceProjection, base: NarrativeBase, findingRecorded: boolean): InstitutionalDecisionNarrative {
  const pr = evidence.publicRecords;
  const keyFindings = truthy([
    `Banker-attested clear result: ${pr.attestedClear ? "yes" : "no"}`,
    `Official adverse source captured: ${pr.officialCaptured ? "yes" : "no"}`,
    pr.searchFormOnly ? "Search limitation: search form only — official result page not captured" : null,
  ]);
  const recommendation: DecisionRecommendation = findingRecorded
    ? "Escalate"
    : pr.officialCaptured
      ? "Approve"
      : pr.attestedClear
        ? "Approve with caveat"
        : "Request more support";
  const confidence: DecisionConfidence = pr.officialCaptured ? "High" : pr.attestedClear ? "Medium" : "Low";
  const conclusion = findingRecorded
    ? "A public-record finding has been recorded and must be reviewed before committee."
    : pr.officialCaptured
      ? "An official adverse-screen source is on file with no unresolved finding."
      : pr.attestedClear
        ? "A banker-attested no-findings result exists; an official adverse search source has not been captured."
        : "No adverse-screen result is recorded yet.";
  const confidenceDrivers: ConfidenceDrivers = {
    positive: truthy([pr.officialCaptured ? "Official adverse source captured" : null, pr.attestedClear ? "Banker-attested clear result" : null]),
    negative: truthy([pr.officialCaptured ? null : "Official adverse search source not captured", pr.searchFormOnly ? "Only a search form / Buddy receipt captured (not official)" : null]),
    neutral: [],
  };
  const recommendationDrivers = [
    findingRecorded
      ? "Escalate: a public-record finding was recorded."
      : pr.officialCaptured
        ? "Approve: an official adverse-screen source is captured."
        : pr.attestedClear
          ? "Approve with caveat: banker-attested clear, but no official adverse source captured."
          : "Request more support: no adverse-screen result recorded.",
  ];
  return { ...base, conclusion, recommendation, confidence, keyFindings, confidenceDrivers, recommendationDrivers };
}

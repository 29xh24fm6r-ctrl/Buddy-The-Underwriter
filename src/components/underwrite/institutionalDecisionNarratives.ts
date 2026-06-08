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
  CommitteeReadinessGroupId,
  CommitteeReadinessGroupView,
  DecisionSupport,
} from "./committeeReadinessView";

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

// ── per-decision narratives ───────────────────────────────────────────────────

export function buildDecisionNarrative(
  groupId: CommitteeReadinessGroupId,
  group: CommitteeReadinessGroupView,
  blockers: CommitteeBlockerResolution[],
  support: DecisionSupport,
  plan: CommitteeRequirementsPlan | null,
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
  const base = { domain, evidenceUsed, evidenceGaps, riskNotes, bankerGuidance: support.bankerGuidance };

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

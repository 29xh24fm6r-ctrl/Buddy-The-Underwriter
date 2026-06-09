/**
 * SPEC-CREDIT-MEMO-CONSUME-COMMITTEE-INTELLIGENCE-1 (PR-A)
 *
 * Pure adapter that projects the SAME committee decision intelligence powering
 * Committee Readiness (institutional decision narratives + the committee blocker
 * lines + evidence classes) into credit-memo prose. The memo therefore stops
 * being a separate, weaker truth surface — it consumes the readiness model
 * verbatim rather than re-deriving contradictory language.
 *
 * Pure: no DB / network / AI. Reads the already-derived readiness model; never
 * mutates tasks/gates, never clears blockers, never approves sources, never
 * changes score/grade/lifecycle. Banker-readable evidence-class labels only.
 */

import type { EvidenceClass } from "@/lib/research/committeeEvidenceProjection";
import type { InstitutionalDecisionNarrative } from "@/components/underwrite/institutionalDecisionNarratives";
import type { CommitteeBlockerLine } from "@/components/underwrite/committeeReadinessView";

/** SPEC §D — banker-readable label per evidence class (no raw enum spam). */
export const MEMO_EVIDENCE_LABEL: Record<EvidenceClass, string> = {
  file_supported: "supported by file evidence",
  borrower_supported: "supported by borrower/banker narrative",
  public_supported: "supported by public source",
  official_supported: "supported by official source",
  banker_attested: "banker-attested",
  committee_grade: "committee-grade accepted",
  contradicted: "contradicted by other evidence",
  not_derivable: "not derivable from current file",
  missing: "not yet on file",
};

/** Default committee blocker copy (mirrors the readiness panel's DECISION_COPY
 *  blocking text) for groups whose blocker line carries no evidence-aware override. */
const DEFAULT_BLOCKING: Record<string, string> = {
  entity: "Entity record not confirmed",
  risk: "Public-records review incomplete",
  management: "Management support missing",
  financial: "Loan/repayment support missing",
  industry: "Industry support missing",
  scale: "Analyst conclusion missing",
};

export interface MemoSourceRef {
  label: string;
  url?: string | null;
  sourceType?: string | null;
  evidenceClass?: EvidenceClass | string | null;
  reviewState?: string | null;
}

export interface MemoDecisionSection {
  groupId: string;
  domain: string;
  conclusion: string;
  recommendation: string;
  confidence: string;
  findings: string[];
  evidenceUsed: string[];
  caveats: string[];
  markdown: string;
}

export interface MemoCommitteeIntelligence {
  committeeReadinessStatus: {
    committeeReady: boolean;
    lines: string[];
    remainingBlockers: string[];
  };
  sections: Record<string, MemoDecisionSection>;
  sources: MemoSourceRef[];
  markdown: string;
}

export interface MemoCommitteeIntelligenceInput {
  narratives: Record<string, InstitutionalDecisionNarrative>;
  committeeBlockers: CommitteeBlockerLine[];
  preliminaryReady: boolean;
  committeeReady: boolean;
  /** Collected source snapshots/artifacts to list as supporting exhibits. */
  sources?: MemoSourceRef[];
}

const classLabel = (c: EvidenceClass | string | null | undefined): string | null =>
  c && (MEMO_EVIDENCE_LABEL as Record<string, string>)[c] ? (MEMO_EVIDENCE_LABEL as Record<string, string>)[c] : null;

function sectionFromNarrative(groupId: string, n: InstitutionalDecisionNarrative): MemoDecisionSection {
  // Business Scale uses the classified six-factor breakdown; others use key findings.
  const findings = n.factors.length
    ? n.factors.map((f) => {
        const lbl = classLabel(f.evidenceClass);
        return `${f.factor}: ${f.status}${lbl ? ` (${lbl})` : ""}`;
      })
    : n.keyFindings;
  const evidenceUsed = n.evidenceUsed.map((e) => {
    const lbl = classLabel(e.evidenceClass);
    return lbl ? `${e.label} — ${lbl}` : e.label;
  });
  const caveats = [...n.confidenceDrivers.negative, ...n.riskNotes];

  const md = [
    `**${n.domain}** — ${n.recommendation} (confidence: ${n.confidence}).`,
    n.conclusion,
    ...findings.map((f) => `- ${f}`),
    ...(evidenceUsed.length ? ["Evidence used:", ...evidenceUsed.map((e) => `- ${e}`)] : []),
    ...(caveats.length ? ["Caveats:", ...caveats.map((c) => `- ${c}`)] : []),
  ].join("\n");

  return {
    groupId,
    domain: n.domain,
    conclusion: n.conclusion,
    recommendation: n.recommendation,
    confidence: n.confidence,
    findings,
    evidenceUsed,
    caveats,
    markdown: md,
  };
}

const blockerCopy = (b: CommitteeBlockerLine): string => b.blocking ?? DEFAULT_BLOCKING[b.groupId] ?? b.label;

export function buildMemoCommitteeIntelligence(input: MemoCommitteeIntelligenceInput): MemoCommitteeIntelligence {
  const sections: Record<string, MemoDecisionSection> = {};
  for (const [groupId, n] of Object.entries(input.narratives)) {
    sections[groupId] = sectionFromNarrative(groupId, n);
  }

  const remainingBlockers = input.committeeBlockers.map(blockerCopy);
  const lines = [
    input.preliminaryReady
      ? "Preliminary underwriting may continue."
      : "Preliminary underwriting is not yet supported.",
    input.committeeReady ? "Committee review is ready." : "Committee review is not ready.",
  ];

  const sources = input.sources ?? [];
  const sourceLines = sources.map((s) => {
    const lbl = classLabel(s.evidenceClass);
    const review = s.reviewState ? ` · ${s.reviewState}` : "";
    return `- ${s.label}${s.url ? ` (${s.url})` : ""}${lbl ? ` — ${lbl}` : ""}${review}`;
  });

  // Memo prose: readiness status first, then the per-decision sections (same
  // order as the readiness blocker list), then collected supporting sources.
  const order = ["management", "industry", "scale", "risk", "entity", "financial"];
  const orderedSections = order.filter((g) => sections[g]).map((g) => sections[g]);

  const markdown = [
    "## Committee Readiness",
    ...lines,
    remainingBlockers.length ? "Remaining blockers:" : "No remaining committee blockers.",
    ...remainingBlockers.map((b) => `- ${b}`),
    "",
    ...orderedSections.flatMap((s) => [s.markdown, ""]),
    ...(sourceLines.length ? ["Supporting sources:", ...sourceLines] : []),
  ].join("\n").trim();

  return {
    committeeReadinessStatus: { committeeReady: input.committeeReady, lines, remainingBlockers },
    sections,
    sources,
    markdown,
  };
}

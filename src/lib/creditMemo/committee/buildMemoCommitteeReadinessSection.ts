/**
 * SPEC-CREDIT-MEMO-CONSUME-COMMITTEE-INTELLIGENCE-1 (PR-B)
 *
 * Pure projection that turns the SAME committee-readiness model the Committee
 * Readiness panel renders into the credit memo's "Committee Readiness and
 * Evidence Status" section. It builds on the PR-A adapter
 * (buildMemoCommitteeIntelligence) — it never re-derives committee logic, never
 * mutates tasks/gates, never approves sources, never changes score/grade.
 *
 * Inputs are an already-derived ResearchGateSnapshot (the panel's model) and the
 * collected source snapshots (for honest exhibit labelling). No DB / network / AI.
 */

import type { ResearchGateSnapshot } from "@/components/underwrite/researchGateTypes";
import {
  memoCommitteeIntelligenceFromSnapshot,
  MEMO_EVIDENCE_LABEL,
  type MemoSourceRef,
} from "./buildMemoCommitteeIntelligence";
import type { EvidenceClass } from "@/lib/research/committeeEvidenceProjection";
import type { ResearchSourceSnapshotRow } from "@/lib/research/quality/buildResearchQualityPayload";

/** Structured memo section — also carries a banker-readable markdown rendering. */
export interface MemoCommitteeReadinessSection {
  committee_ready: boolean;
  status_line: string;
  remaining_blockers: string[];
  decision_support: Array<{
    group_id: string;
    domain: string;
    recommendation: string;
    confidence: string;
    conclusion: string;
    evidence: string[];
    caveats: string[];
  }>;
  sources: Array<{
    label: string;
    url: string | null;
    evidence_label: string | null;
    review_state: string | null;
    committee_approved: false;
  }>;
  markdown: string;
}

// Census/BLS/FRED + SOS/registry are official; borrower website is borrower-owned;
// everything else collected from the open web is public.
function evidenceClassForSource(row: ResearchSourceSnapshotRow): EvidenceClass {
  const type = String(row.source_type ?? "").toLowerCase();
  const url = String(row.source_url ?? "").toLowerCase();
  const isOfficial =
    /government|census|bls|fred|bea|sos|secretary|registry|registr/.test(type) ||
    /\.gov\b|data\.census\.gov|bls\.gov|fred\.stlouisfed/.test(url);
  if (isOfficial) return "official_supported";
  if (/website|borrower_official/.test(type)) return "borrower_supported";
  return "public_supported";
}

// Honest review state — never "committee approved". Collected sources are
// review-required until a banker/analyst grades them.
function reviewStateForSource(row: ResearchSourceSnapshotRow): string {
  const status = String(row.status ?? "").toLowerCase();
  const reviewed = String(row.reviewed_status ?? "").toLowerCase();
  if (status === "failed") return "collection failed";
  if (status === "manual_attestation") return "banker-attested";
  if (reviewed === "accepted" || reviewed === "reviewed") return "reviewed (not committee-approved)";
  if (reviewed === "rejected") return "rejected on review";
  // collected / candidate / pending → still needs review
  return "collected for review";
}

function humanizeSourceType(type: string | null): string {
  if (!type) return "Source";
  return type
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Map collected source snapshots → memo source refs with honest labels. */
export function buildMemoSourceRefs(rows: ResearchSourceSnapshotRow[]): MemoSourceRef[] {
  return rows
    .filter((r) => !!r.source_url || !!r.source_type)
    .map((r) => ({
      label: r.source_title ?? r.title ?? humanizeSourceType(r.source_type) ?? r.source_url ?? "Source",
      url: r.source_url ?? null,
      sourceType: r.source_type ?? null,
      evidenceClass: evidenceClassForSource(r),
      reviewState: reviewStateForSource(r),
    }));
}

const classLabel = (c: EvidenceClass | string | null | undefined): string | null =>
  c && (MEMO_EVIDENCE_LABEL as Record<string, string>)[c]
    ? (MEMO_EVIDENCE_LABEL as Record<string, string>)[c]
    : null;

// Same display order the readiness panel uses for its decision groups.
const DOMAIN_ORDER = ["management", "industry", "scale", "risk", "entity", "financial"];

function renderMarkdown(section: MemoCommitteeReadinessSection): string {
  const lines: string[] = ["## Committee Readiness and Evidence Status", "", "Status:", section.status_line, ""];

  if (section.remaining_blockers.length > 0) {
    lines.push("Remaining blockers:");
    for (const b of section.remaining_blockers) lines.push(`- ${b}`);
  } else {
    lines.push("No remaining committee blockers.");
  }
  lines.push("");

  lines.push("Decision support:");
  for (const d of section.decision_support) {
    lines.push("");
    lines.push(`${d.domain}:`);
    lines.push(`${d.recommendation} / ${d.confidence}.`);
    if (d.conclusion) lines.push(d.conclusion);
    for (const e of d.evidence) lines.push(`- ${e}`);
    for (const c of d.caveats) lines.push(`- Caveat: ${c}`);
  }

  if (section.sources.length > 0) {
    lines.push("");
    lines.push("Supporting sources:");
    for (const s of section.sources) {
      const lbl = s.evidence_label ? ` — ${s.evidence_label}` : "";
      const rev = s.review_state ? ` · ${s.review_state}` : "";
      lines.push(`- ${s.label}${s.url ? ` (${s.url})` : ""}${lbl}${rev}`);
    }
  }

  return lines.join("\n").trim();
}

/**
 * Build the memo "Committee Readiness and Evidence Status" section from the same
 * readiness snapshot the panel uses. Returns null when there is no committee
 * model to project (no gate / mission). Pure.
 */
export function buildMemoCommitteeReadinessSection(
  snapshot: ResearchGateSnapshot,
  sourceRows: ResearchSourceSnapshotRow[] = [],
): MemoCommitteeReadinessSection | null {
  // Reuse the single cross-layer seam (PR-B): snapshot → committee intelligence.
  // Never re-derives committee logic — same path the UI memo build uses.
  const sources = buildMemoSourceRefs(sourceRows);
  const intel = memoCommitteeIntelligenceFromSnapshot(snapshot, sources);
  if (!intel) return null;

  const committeeReady = intel.committeeReadinessStatus.committeeReady;
  const orderedGroups = [
    ...DOMAIN_ORDER.filter((g) => intel.sections[g]),
    ...Object.keys(intel.sections).filter((g) => !DOMAIN_ORDER.includes(g)),
  ];

  const decision_support = orderedGroups.map((g) => {
    const s = intel.sections[g];
    return {
      group_id: g,
      domain: s.domain,
      recommendation: s.recommendation,
      confidence: s.confidence,
      conclusion: s.conclusion,
      evidence: s.evidenceUsed,
      caveats: s.caveats,
    };
  });

  const section: MemoCommitteeReadinessSection = {
    committee_ready: committeeReady,
    status_line: committeeReady ? "Ready for committee review." : "Not ready for committee review.",
    remaining_blockers: intel.committeeReadinessStatus.remainingBlockers,
    decision_support,
    sources: intel.sources.map((s) => ({
      label: s.label,
      url: s.url ?? null,
      evidence_label: classLabel(s.evidenceClass),
      review_state: s.reviewState ?? null,
      committee_approved: false as const,
    })),
    markdown: "",
  };
  section.markdown = renderMarkdown(section);
  return section;
}

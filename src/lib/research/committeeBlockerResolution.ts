/**
 * SPEC-BIE-EVIDENCE-GRAPH-AND-COMMITTEE-BLOCKER-RESOLUTION-1
 *
 * Turns the gate's flat `committee_blockers: string[]` into actionable,
 * evidence-linked resolution items. Reads the structured gate output
 * (evidence_quality, section_source_statuses, contradiction_checklist) plus the
 * mission's buddy_research_evidence rows, and produces, per blocker:
 *   - why it blocks committee
 *   - the evidence ALREADY on file that supports it (linked from the claim ledger)
 *   - the evidence still missing
 *   - the banker's next actions + acceptable evidence examples
 *   - whether banker certification suffices for PRELIMINARY (it already does) vs
 *     whether public/attested evidence is REQUIRED for committee.
 *
 * Pure module (no server-only, no DB). Never fabricates evidence — if no claim
 * ledger rows match a blocker, existing_supporting_evidence is empty.
 *
 * Does NOT change gate semantics, scoring, thresholds, or eligibility — it only
 * EXPLAINS the already-computed committee blockers.
 */

import type { EvidenceQualityResult } from "./evidenceQuality";
import type { SectionSourceStatus } from "./sectionSourceStatus";
import type { ContradictionCheck } from "./contradictionChecklist";

export type CommitteeBlockerType =
  | "public_entity_verification"
  | "management_verification"
  | "adverse_screen"
  | "source_quality"
  | "section_source_gap"
  | "evidence_coverage"
  | "contradiction_gap"
  | "financial_file_gap"
  | "collateral_file_gap"
  | "other";

export type CommitteeBlockerResolution = {
  blocker_id: string;
  title: string;
  blocker_type: CommitteeBlockerType;
  severity: "committee_blocker" | "review_required" | "info";
  current_status: "missing" | "partial" | "present_but_not_committee_grade" | "resolved";
  why_it_blocks_committee: string;
  existing_supporting_evidence: Array<{
    claim_id?: string;
    section?: string;
    thread_origin?: string;
    evidence_type?: string;
    claim_preview: string;
    confidence?: number;
  }>;
  missing_evidence: string[];
  recommended_actions: string[];
  acceptable_evidence_examples: string[];
  can_be_banker_certified_for_preliminary: boolean;
  requires_public_or_attested_evidence_for_committee: boolean;
};

/** Minimal shape of a buddy_research_evidence row needed for linkage. */
export type EvidenceRowInput = {
  id?: string | null;
  section?: string | null;
  thread_origin?: string | null;
  evidence_type?: string | null;
  claim?: string | null;
  confidence?: number | null;
  source_uris?: string[] | null;
  source_types?: string[] | null;
};

export type CommitteeBlockerResolutionInput = {
  committeeBlockers: string[];
  evidenceQuality: EvidenceQualityResult | null;
  sectionSourceStatuses: SectionSourceStatus[];
  contradictionChecklist: ContradictionCheck[];
  evidenceRows: EvidenceRowInput[];
  subject?: { company_name?: string | null; website?: string | null } | null;
};

const SECTION_PREFIX = "Section needs committee-grade sources: ";
const CONTRADICTION_PREFIX = "Contradiction check unresolved: ";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
}

function preview(claim: string | null | undefined): string {
  return (claim ?? "").trim().slice(0, 160);
}

function linkEvidence(
  rows: EvidenceRowInput[],
  match: (r: EvidenceRowInput) => boolean,
  limit = 5,
): CommitteeBlockerResolution["existing_supporting_evidence"] {
  return rows
    .filter(match)
    .filter((r) => (r.claim ?? "").trim().length > 0)
    .slice(0, limit)
    .map((r) => ({
      claim_id: r.id ?? undefined,
      section: r.section ?? undefined,
      thread_origin: r.thread_origin ?? undefined,
      evidence_type: r.evidence_type ?? undefined,
      claim_preview: preview(r.claim),
      confidence: r.confidence ?? undefined,
    }));
}

const inSections = (sections: string[]) => (r: EvidenceRowInput) =>
  !!r.section && sections.includes(r.section);
const inThreads = (threads: string[]) => (r: EvidenceRowInput) =>
  !!r.thread_origin && threads.includes(r.thread_origin);

// Section-specific committee evidence guidance.
const SECTION_GUIDANCE: Record<
  string,
  { type: CommitteeBlockerType; actions: string[]; examples: string[]; threads: string[] }
> = {
  "Management Intelligence": {
    type: "management_verification",
    actions: [
      "Attach an ownership/management profile or borrower-certified management statement",
      "Confirm the principal's role via a public/official record (Secretary of State officer listing, license, press)",
      "Record a public adverse screen result for the principal(s)",
    ],
    examples: [
      "Secretary-of-state officer/registered-agent listing",
      "Professional license or credential record",
      "Borrower-signed management attestation / resume / PFS",
    ],
    threads: ["management"],
  },
  "Litigation and Risk": {
    type: "adverse_screen",
    actions: [
      "Run a public adverse-record screen (court / regulatory / lien) and record the result",
      "If no authoritative source is available, attach an explicit analyst manual-review note",
    ],
    examples: [
      "PACER / court-record search result",
      "Regulatory enforcement / sanctions search (e.g. SAM.gov)",
      "Analyst-attested adverse-screen note",
    ],
    threads: ["borrower"],
  },
  "Industry Overview": {
    type: "section_source_gap",
    actions: ["Add a government/trade/market research source for the industry"],
    examples: ["BLS / Census industry data", "IBISWorld / Statista", "Recognized trade publication"],
    threads: ["industry"],
  },
  "Market Intelligence": {
    type: "section_source_gap",
    actions: ["Add an official local-market source"],
    examples: ["BLS / Census / FRED data", "Local government / economic-development source"],
    threads: ["market"],
  },
  "Competitive Landscape": {
    type: "section_source_gap",
    actions: ["Add verifiable support for the named competitors"],
    examples: ["Competitor company website / press", "Trade publication naming competitors"],
    threads: ["competitive"],
  },
  "Borrower Profile": {
    type: "public_entity_verification",
    actions: [
      "Add the borrower's official website as a source, or attach accepted file evidence",
      "Confirm the legal entity via a public registry record",
    ],
    examples: ["Borrower official website", "Secretary-of-state / business registry record", "Borrower-certified entity documents"],
    threads: ["borrower", "entity_lock"],
  },
};

export function buildCommitteeBlockerResolutions(
  input: CommitteeBlockerResolutionInput,
): CommitteeBlockerResolution[] {
  const rows = input.evidenceRows ?? [];
  const eq = input.evidenceQuality;
  const out: CommitteeBlockerResolution[] = [];

  for (const blocker of input.committeeBlockers ?? []) {
    // ── Wrong/conflicting entity — HARD, never banker-certifiable ───────────
    if (/wrong\/conflicting public entity|conflicting public entity/i.test(blocker)) {
      out.push({
        blocker_id: slug(blocker),
        title: "Resolve wrong/conflicting public entity",
        blocker_type: "other",
        severity: "committee_blocker",
        current_status: "missing",
        why_it_blocks_committee:
          "Research may describe a different company than the borrower. Identity must be resolved before any reliance — banker certification cannot override this.",
        existing_supporting_evidence: linkEvidence(rows, inThreads(["entity_lock", "borrower"])),
        missing_evidence: ["Authoritative confirmation of the correct legal entity"],
        recommended_actions: [
          "Provide the exact legal borrower name / DBA / website",
          "Attach a public registry record confirming the borrower entity",
          "Re-run research once identity is corrected",
        ],
        acceptable_evidence_examples: ["Secretary-of-state registration", "EIN / formation documents", "Official borrower website matching the legal entity"],
        can_be_banker_certified_for_preliminary: false,
        requires_public_or_attested_evidence_for_committee: true,
      });
      continue;
    }

    // ── Public/attested ENTITY verification ─────────────────────────────────
    if (/public\/attested entity verification/i.test(blocker)) {
      const hasWebsite = !!input.subject?.website;
      out.push({
        blocker_id: slug(blocker),
        title: "Public/attested entity verification",
        blocker_type: "public_entity_verification",
        severity: "committee_blocker",
        current_status: hasWebsite ? "present_but_not_committee_grade" : "missing",
        why_it_blocks_committee:
          "Committee requires the borrower entity to be confirmed by a public/official source or an attested supporting document.",
        existing_supporting_evidence: linkEvidence(rows, inThreads(["entity_lock", "borrower"])),
        missing_evidence: ["Public/official entity record OR attested entity document"],
        recommended_actions: [
          "Attach secretary-of-state registration or a public registry record",
          "Verify the borrower's official website/domain against the legal borrower",
          "Attach signed borrower certification / legal entity documents",
          "Mark an existing source as accepted if it already confirms the entity",
        ],
        acceptable_evidence_examples: ["Secretary-of-state / business registry record", "Borrower official website", "Borrower-certified entity documents"],
        can_be_banker_certified_for_preliminary: true,
        requires_public_or_attested_evidence_for_committee: true,
      });
      continue;
    }

    // ── Management verification + adverse screen ─────────────────────────────
    if (/management verification|adverse screen/i.test(blocker)) {
      const mgmtRows = linkEvidence(rows, (r) =>
        inSections(["Management Intelligence", "Management Red Flags"])(r) || inThreads(["management"])(r),
      );
      out.push({
        blocker_id: slug(blocker),
        title: "Public/attested management verification + adverse screen",
        blocker_type: "management_verification",
        severity: "committee_blocker",
        current_status: mgmtRows.length > 0 ? "present_but_not_committee_grade" : "missing",
        why_it_blocks_committee:
          "Management is banker-certified/file-based but not publicly or attested-verified, and the adverse screen is not committee-grade.",
        existing_supporting_evidence: mgmtRows,
        missing_evidence: [
          "Public/official confirmation of management role",
          "Completed public adverse screen result",
        ],
        recommended_actions: [
          "Attach ownership/management profile or borrower-certified management statement",
          "Attach resume/bio or personal background / PFS / ownership documents as applicable",
          "Run a public adverse screen and record the result",
          "Mark the management profile attested or analyst-accepted",
        ],
        acceptable_evidence_examples: [
          "Secretary-of-state officer listing",
          "Professional license / credential record",
          "Borrower-signed management attestation",
          "Adverse-screen (court/regulatory/lien) result",
        ],
        can_be_banker_certified_for_preliminary: true,
        requires_public_or_attested_evidence_for_committee: true,
      });
      continue;
    }

    // ── Stronger public/institutional sources ───────────────────────────────
    if (/public\/institutional sources/i.test(blocker)) {
      const sourced = linkEvidence(
        rows,
        (r) => Array.isArray(r.source_uris) && r.source_uris.length > 0,
        8,
      );
      out.push({
        blocker_id: slug(blocker),
        title: "Stronger public/institutional sources required",
        blocker_type: "source_quality",
        severity: "committee_blocker",
        current_status: eq && !eq.public_web_limited ? "present_but_not_committee_grade"
          : (eq?.public_web_quality_score ?? 0) > 0 ? "present_but_not_committee_grade" : "missing",
        why_it_blocks_committee:
          `Public source quality is ${Math.round((eq?.public_web_quality_score ?? 0) * 100)}% with no primary/institutional sources. `
          + "Public web coverage is limited (expected for a private borrower), but committee requires stronger official/attested support.",
        existing_supporting_evidence: sourced,
        missing_evidence: ["At least one primary/institutional public source (gov / registry / trade / primary news)"],
        recommended_actions: [
          "Add the borrower official website as a source",
          "Add a state registry / secretary-of-state source snapshot",
          "Add a government/industry market source (BLS, Census, IBISWorld, trade publication)",
          "Add a local/trade source if available",
          "Identify which sections lack committee-grade support",
        ],
        acceptable_evidence_examples: ["Secretary-of-state record", "BLS / Census / FRED data", "Trade publication", "Primary news outlet"],
        can_be_banker_certified_for_preliminary: true,
        requires_public_or_attested_evidence_for_committee: true,
      });
      continue;
    }

    // ── Evidence coverage below committee threshold ─────────────────────────
    if (/evidence coverage below committee/i.test(blocker)) {
      const supporting = linkEvidence(rows, () => true, 8);
      const missing = eq?.missing_items?.length
        ? eq.missing_items
        : ["Additional loan-file / public evidence to reach 85% coverage"];
      out.push({
        blocker_id: slug(blocker),
        title: "Evidence coverage below committee threshold",
        blocker_type: "evidence_coverage",
        severity: "committee_blocker",
        current_status: "partial",
        why_it_blocks_committee:
          `Certified evidence coverage is ${Math.round((eq?.certified_evidence_coverage_score ?? 0) * 100)}% — committee requires ≥85%. `
          + "Preliminary is satisfied; committee needs the remaining evidence items below.",
        existing_supporting_evidence: supporting,
        missing_evidence: missing,
        recommended_actions: [
          "Attach the missing financial evidence (DSCR, financial statements / tax returns)",
          "Attach loan request / use of proceeds and collateral records",
          "Add the missing public/institutional sources",
        ],
        acceptable_evidence_examples: [
          "Spread-based DSCR + financial statements",
          "Loan request / use of proceeds",
          "Collateral records / appraisal",
          "Primary/institutional public source",
        ],
        can_be_banker_certified_for_preliminary: true,
        requires_public_or_attested_evidence_for_committee: true,
      });
      continue;
    }

    // ── Section-level committee source gap ──────────────────────────────────
    if (blocker.startsWith(SECTION_PREFIX)) {
      const section = blocker.slice(SECTION_PREFIX.length).trim();
      const g = SECTION_GUIDANCE[section] ?? {
        type: "section_source_gap" as CommitteeBlockerType,
        actions: ["Add a committee-grade source supporting this section"],
        examples: ["Primary/institutional public source"],
        threads: [],
      };
      const status = input.sectionSourceStatuses.find((s) => s.section === section);
      const linked = linkEvidence(rows, (r) =>
        (r.section === section) || (g.threads.length > 0 && inThreads(g.threads)(r)),
      );
      out.push({
        blocker_id: slug(blocker),
        title: `Section needs committee-grade sources: ${section}`,
        blocker_type: g.type,
        severity: "committee_blocker",
        current_status: status?.committee_source_status === "fail" ? "missing" : "present_but_not_committee_grade",
        why_it_blocks_committee:
          status?.detail
          ?? `${section} does not yet rest on committee-grade sources (current basis: ${status?.evidence_basis ?? "insufficient"}).`,
        existing_supporting_evidence: linked,
        missing_evidence: [`Committee-grade source for ${section}`],
        recommended_actions: g.actions,
        acceptable_evidence_examples: g.examples,
        can_be_banker_certified_for_preliminary: true,
        requires_public_or_attested_evidence_for_committee: true,
      });
      continue;
    }

    // ── Contradiction check unresolved ──────────────────────────────────────
    if (blocker.startsWith(CONTRADICTION_PREFIX)) {
      const key = blocker.slice(CONTRADICTION_PREFIX.length).trim();
      const check = input.contradictionChecklist.find((c) => c.check_key === key);
      const linked = linkEvidence(rows, inSections(["Contradictions", "Underwriting Questions"]));
      const isFlagged = check?.status === "flagged";
      out.push({
        blocker_id: slug(blocker),
        title: `Contradiction unresolved: ${key.replace(/_/g, " ")}`,
        blocker_type: "contradiction_gap",
        severity: "committee_blocker",
        // Flagged = an actual contradiction surfaced; insufficient_evidence = couldn't assess.
        current_status: isFlagged ? "partial" : "missing",
        why_it_blocks_committee:
          check?.basis
          ?? `The adversarial check "${key}" is ${check?.status ?? "unresolved"} and must be cleared with evidence before committee. It is NOT auto-cleared.`,
        existing_supporting_evidence: linked,
        missing_evidence: [`Evidence that resolves the "${key}" check`],
        recommended_actions: [
          `Provide evidence that addresses the "${key}" concern (do not mark clear without it)`,
          isFlagged
            ? "Reconcile the flagged inconsistency in the file or document the mitigant"
            : "Supply the missing data so the check can be assessed",
        ],
        acceptable_evidence_examples: contradictionExamples(key),
        can_be_banker_certified_for_preliminary: true,
        requires_public_or_attested_evidence_for_committee: true,
      });
      continue;
    }

    // ── Fallback: unknown blocker string ────────────────────────────────────
    out.push({
      blocker_id: slug(blocker),
      title: blocker,
      blocker_type: "other",
      severity: "committee_blocker",
      current_status: "partial",
      why_it_blocks_committee: blocker,
      existing_supporting_evidence: [],
      missing_evidence: ["See blocker description"],
      recommended_actions: ["Review the blocker and attach supporting evidence"],
      acceptable_evidence_examples: [],
      can_be_banker_certified_for_preliminary: true,
      requires_public_or_attested_evidence_for_committee: true,
    });
  }

  return out;
}

function contradictionExamples(key: string): string[] {
  switch (key) {
    case "scale_plausibility":
      return ["Financial statements / tax returns confirming revenue scale", "Headcount or payroll documentation"];
    case "geography_mismatch":
      return ["Official record confirming HQ / operating location"];
    case "management_history_conflict":
      return ["Public/attested principal history (license, press, registry)"];
    case "repayment_story_conflict":
      return ["Spread-based DSCR + cash-flow documentation"];
    default:
      return ["Authoritative document or public record addressing the check"];
  }
}

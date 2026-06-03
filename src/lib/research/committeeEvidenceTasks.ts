/**
 * SPEC-BIE-SOURCE-SNAPSHOT-LEDGER-AND-OFFICIAL-SOURCE-CONNECTORS-1
 *
 * First evidence-collection layer. Turns CommitteeBlockerResolution rows into
 * concrete evidence-collection TASK SPECS, one per (blocker_id, task_type). The
 * borrower-website task is auto-collectible (a real fetch connector); the rest
 * are manual task generators (SoS/registry, adverse screen, management
 * attestation, BLS/Census/FRED/industry, competitive support, financial file).
 *
 * Pure module (no server-only, no DB) — fully unit-testable. Generation only:
 * it does NOT change scoring, gate semantics, committee thresholds, or clear
 * any committee readiness.
 */

import type { CommitteeBlockerResolution } from "./committeeBlockerResolution";

export type CommitteeTaskType =
  | "borrower_website_snapshot"
  | "sos_business_registry"
  | "public_adverse_screen"
  | "management_attestation"
  | "industry_market_source"
  | "competitive_source"
  | "financial_file"
  | "manual_review";

export type CommitteeTaskStatus = "pending" | "collected" | "accepted" | "rejected";

/** A generated task spec (pre-persistence). */
export type CommitteeEvidenceTaskSpec = {
  blocker_id: string;
  blocker_type: string;
  task_type: CommitteeTaskType;
  title: string;
  instructions: string;
  auto_collectible: boolean;
  target_url: string | null;
};

/**
 * SPEC-BIE-COMMITTEE-EVIDENCE-COLLECTION-FROM-BLOCKERS-1: derived-on-read
 * enrichment statuses. The persisted `status` is the banker WORKFLOW state
 * (pending/collected/accepted/rejected); `evidence_status` is what the actual
 * loan file says (missing/collected/needs_review); `resolved_status` is the
 * composed 5-value status the UI shows.
 */
export type EvidenceTaskFileStatus = "missing" | "collected" | "needs_review";
export type EvidenceTaskResolvedStatus =
  | "missing"
  | "collected"
  | "needs_review"
  | "accepted"
  | "rejected";

export type TaskEvidenceLink = {
  kind:
    | "research_claim"
    | "document"
    | "financial_fact"
    | "borrower_story"
    | "management_profile"
    | "source";
  id?: string;
  label: string;
  detail?: string;
};

/** One enumerated item of the evidence-coverage checklist. */
export type CoverageChecklistItem = {
  label: string;
  status: EvidenceTaskFileStatus;
  collect_from: string;
  linked_evidence: TaskEvidenceLink[];
  acceptable_evidence: string[];
  linked_sections: string[];
};

/** The persisted task shape (returned to UI / API). */
export type CommitteeEvidenceTask = {
  id?: string;
  blocker_id: string;
  blocker_type?: string | null;
  task_type: CommitteeTaskType | string;
  title?: string | null;
  instructions?: string | null;
  status: CommitteeTaskStatus | string;
  auto_collectible?: boolean;
  target_url?: string | null;
  source_snapshot_id?: string | null;
  // ── SPEC-BIE-COMMITTEE-EVIDENCE-COLLECTION-FROM-BLOCKERS-1 enrichment ──
  // (derived-on-read by enrichCommitteeTasks; absent until enriched).
  /** What the loan file already provides for this task. */
  evidence_status?: EvidenceTaskFileStatus;
  /** Composed display status: banker action (accepted/rejected/collected) wins, else file-derived. */
  resolved_status?: EvidenceTaskResolvedStatus;
  /** Existing file/research evidence linked to this task. */
  linked_evidence?: TaskEvidenceLink[];
  /** Research/memo sections this task supports. */
  linked_sections?: string[];
  /** For the evidence-coverage task: the enumerated per-item checklist. */
  checklist?: CoverageChecklistItem[];
  /** Contradiction / scale tasks must never auto-clear. */
  auto_clear_forbidden?: boolean;
};

type Subject = { company_name?: string | null; website?: string | null; naics_code?: string | null } | null;

const TASK_TEMPLATES: Record<CommitteeTaskType, { title: string; instructions: string; auto: boolean }> = {
  borrower_website_snapshot: {
    title: "Snapshot the borrower's official website",
    instructions: "Buddy fetches and snapshots the borrower's official website as a primary source. Verify the domain matches the legal borrower.",
    auto: true,
  },
  sos_business_registry: {
    title: "Attach Secretary of State / business registry record",
    instructions: "Attach a secretary-of-state registration or business-registry record (e.g. OpenCorporates, state SoS) confirming the legal entity.",
    auto: false,
  },
  public_adverse_screen: {
    title: "Run public adverse-record screen",
    instructions: "Run a public adverse screen (court / regulatory / lien / sanctions) and record the result, or attach an explicit analyst manual-review note.",
    auto: false,
  },
  management_attestation: {
    title: "Attach management/ownership attestation",
    instructions: "Attach an ownership/management profile, borrower-certified management statement, resume/bio, or PFS confirming the principal's role.",
    auto: false,
  },
  industry_market_source: {
    title: "Attach government / industry market source",
    instructions: "Attach a government or industry source (BLS, Census, FRED, IBISWorld, or a recognized trade publication) supporting the industry/market analysis.",
    auto: false,
  },
  competitive_source: {
    title: "Attach competitive source support",
    instructions: "Attach verifiable support for the named competitors (competitor websites/press or trade publications).",
    auto: false,
  },
  financial_file: {
    title: "Attach financial file evidence",
    instructions: "Attach the missing financial evidence (spread-based DSCR, financial statements / tax returns, loan request, collateral records).",
    auto: false,
  },
  manual_review: {
    title: "Analyst manual review",
    instructions: "Resolve this blocker with an attached document or an explicit analyst manual-review note.",
    auto: false,
  },
};

/** Which task types each blocker_type maps to. Section gaps resolve by title. */
function taskTypesFor(r: CommitteeBlockerResolution): CommitteeTaskType[] {
  switch (r.blocker_type) {
    case "public_entity_verification":
      return ["sos_business_registry", "borrower_website_snapshot"];
    case "management_verification":
      return ["management_attestation", "public_adverse_screen"];
    case "adverse_screen":
      return ["public_adverse_screen"];
    case "source_quality":
      return ["borrower_website_snapshot", "sos_business_registry"];
    case "evidence_coverage":
      return ["financial_file"];
    case "financial_file_gap":
      return ["financial_file"];
    case "collateral_file_gap":
      return ["financial_file"];
    case "section_source_gap": {
      const t = r.title.toLowerCase();
      if (t.includes("industry") || t.includes("market")) return ["industry_market_source"];
      if (t.includes("competitive")) return ["competitive_source"];
      return ["manual_review"];
    }
    case "contradiction_gap":
      return r.title.toLowerCase().includes("scale") ? ["financial_file"] : ["manual_review"];
    case "other":
    default:
      return ["manual_review"];
  }
}

/**
 * Generate evidence-collection task specs for a set of committee blocker
 * resolutions. Deduplicated by (blocker_id, task_type). The borrower-website
 * task carries the subject website as its target_url and is auto-collectible.
 */
export function generateCommitteeEvidenceTaskSpecs(
  resolutions: CommitteeBlockerResolution[],
  subject: Subject,
): CommitteeEvidenceTaskSpec[] {
  const out: CommitteeEvidenceTaskSpec[] = [];
  const seen = new Set<string>();
  const website = subject?.website?.trim() || null;
  const naics = subject?.naics_code?.trim() || null;

  for (const r of resolutions ?? []) {
    for (const taskType of taskTypesFor(r)) {
      const key = `${r.blocker_id}::${taskType}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const tpl = TASK_TEMPLATES[taskType];
      let instructions = tpl.instructions;
      if (taskType === "industry_market_source" && naics) {
        instructions += ` Target NAICS ${naics}.`;
      }
      out.push({
        blocker_id: r.blocker_id,
        blocker_type: r.blocker_type,
        task_type: taskType,
        title: tpl.title,
        instructions,
        auto_collectible: tpl.auto,
        target_url: taskType === "borrower_website_snapshot" ? website : null,
      });
    }
  }
  return out;
}

/** Distinct task types present in a set of specs (for summaries/acceptance). */
export function taskTypeSet(specs: CommitteeEvidenceTaskSpec[]): CommitteeTaskType[] {
  return [...new Set(specs.map((s) => s.task_type))];
}

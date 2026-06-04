/**
 * SPEC-BIE-COMMITTEE-EVIDENCE-COLLECTION-FROM-BLOCKERS-1
 *
 * Strengthens the committee evidence-collection layer
 * (committeeEvidenceTasks.ts / committeeEvidenceCollection.ts) by LINKING each
 * generated task to the actual loan file and deriving a real status, instead of
 * leaving every task "pending".
 *
 * The gate's `evidence_quality.missing_items` is computed from the RESEARCH
 * signal only, so it flags items like "DSCR" or "Financial statements" as
 * missing even when the loan file holds them. This module re-links each task
 * against deal_documents / deal_financial_facts / deal_borrower_story /
 * deal_management_profiles (+ the research claim ledger) and flips a task to
 * `collected` when the file already satisfies it. The evidence-coverage task is
 * exploded into a per-item checklist (the "paragraph → checklist" transform).
 *
 * Pure module — no server-only, no DB, no fabrication. Derived-on-read; nothing
 * is persisted. Composition rule for the displayed `resolved_status`:
 *   accepted / rejected (a banker action) win; an auto-collected `collected`
 *   persists; otherwise the file-derived status (missing/collected/needs_review)
 *   is shown. Never changes preliminary, committee thresholds, or auto-clears a
 *   blocker. Contradiction / scale tasks carry auto_clear_forbidden=true.
 */

import type { EvidenceRowInput } from "./committeeBlockerResolution";
import type {
  CommitteeEvidenceTask,
  CoverageChecklistItem,
  EvidenceTaskFileStatus,
  EvidenceTaskResolvedStatus,
  TaskEvidenceLink,
} from "./committeeEvidenceTasks";
import {
  PRIMARY_INSTITUTIONAL_SOURCE_TYPES,
  normalizeDomain,
  type SourceType,
} from "./sourcePolicy";

export type DocInput = {
  id?: string | null;
  canonical_type?: string | null;
  document_type?: string | null;
  document_category?: string | null;
  original_filename?: string | null;
  status?: string | null;
};
export type FactInput = { fact_key?: string | null; fact_type?: string | null };
export type StoryInput = {
  products_services?: string | null;
  customer_concentration?: string | null;
  competitive_position?: string | null;
  website?: string | null;
} | null;
export type MgmtInput = {
  id?: string | null;
  person_name?: string | null;
  title?: string | null;
  source?: string | null;
};

export type TaskLinkInput = {
  evidenceRows: EvidenceRowInput[];
  documents: DocInput[];
  financialFacts: FactInput[];
  borrowerStory: StoryInput;
  managementProfiles: MgmtInput[];
  subject?: { website?: string | null } | null;
};

// ── File-context probes ──────────────────────────────────────────────────────

const FINANCIAL_DOC_TYPES = new Set([
  "INCOME_STATEMENT",
  "BALANCE_SHEET",
  "BUSINESS_TAX_RETURN",
  "PERSONAL_TAX_RETURN",
  "CASH_FLOW_STATEMENT",
  "PROFIT_AND_LOSS",
]);
const COLLATERAL_DOC_TYPES = new Set([
  "AR_AGING",
  "APPRAISAL",
  "COLLATERAL",
  "EQUIPMENT_LIST",
  "INVENTORY_REPORT",
]);
const AR_FACT_KEYS = ["ELIGIBLE_AR", "TOTAL_AR", "OVER_90_AR", "AR_SCH_L", "SL_AR_GROSS"];
const REVENUE_FACT_KEYS = ["TOTAL_REVENUE", "GROSS_RECEIPTS", "TOTAL_INCOME", "SCHEDULE_C_GROSS_RECEIPTS"];
const SECTION_SOURCE_TYPES: SourceType[] = [
  "government_data",
  "business_registry",
  "secretary_of_state",
  "news_primary",
  "trade_publication",
  "market_research",
];
const REGISTRY_SOURCE_TYPES: SourceType[] = ["secretary_of_state", "business_registry"];
const ADVERSE_SOURCE_TYPES: SourceType[] = [
  "public_adverse_record_search",
  "court_record",
  "regulatory_filing",
];

type FileContext = {
  websiteDomain: string | null;
  websiteSources: EvidenceRowInput[];
  registrySources: EvidenceRowInput[];
  adverseSources: EvidenceRowInput[];
  industrySources: EvidenceRowInput[];
  marketSources: EvidenceRowInput[];
  competitorRows: EvidenceRowInput[];
  competitorSourced: EvidenceRowInput[];
  managementRows: EvidenceRowInput[];
  primarySources: EvidenceRowInput[];
  hasProducts: boolean;
  hasCustomerConcentration: boolean;
  hasDscr: boolean;
  hasRevenue: boolean;
  hasArSupport: boolean;
  financialDocs: DocInput[];
  collateralDocs: DocInput[];
  managementProfiles: MgmtInput[];
  financialFacts: FactInput[];
};

const sourceTypesOf = (r: EvidenceRowInput): string[] =>
  Array.isArray(r.source_types) ? r.source_types : [];
const sourceUrisOf = (r: EvidenceRowInput): string[] =>
  Array.isArray(r.source_uris) ? r.source_uris : [];
const hasAnyType = (r: EvidenceRowInput, types: SourceType[]) =>
  sourceTypesOf(r).some((s) => (types as string[]).includes(s));

function buildContext(input: TaskLinkInput): FileContext {
  const rows = input.evidenceRows ?? [];
  const docs = input.documents ?? [];
  const facts = input.financialFacts ?? [];
  const factKeys = new Set(facts.map((f) => (f.fact_key ?? "").toUpperCase()).filter(Boolean));

  const websiteRaw = input.subject?.website ?? input.borrowerStory?.website ?? null;
  const websiteDomain = normalizeDomain(websiteRaw);

  const docHas = (set: Set<string>) =>
    docs.filter((d) => set.has((d.canonical_type ?? d.document_type ?? "").toUpperCase()));
  const financialDocs = docHas(FINANCIAL_DOC_TYPES);
  const collateralDocs = docHas(COLLATERAL_DOC_TYPES);
  const byThread = (t: string) => rows.filter((r) => r.thread_origin === t);

  return {
    websiteDomain,
    websiteSources: rows.filter(
      (r) =>
        sourceTypesOf(r).includes("borrower_official_website") ||
        (!!websiteDomain && sourceUrisOf(r).some((u) => normalizeDomain(u) === websiteDomain)),
    ),
    registrySources: rows.filter((r) => hasAnyType(r, REGISTRY_SOURCE_TYPES)),
    adverseSources: rows.filter((r) => hasAnyType(r, ADVERSE_SOURCE_TYPES)),
    industrySources: byThread("industry").filter((r) => hasAnyType(r, SECTION_SOURCE_TYPES)),
    marketSources: byThread("market").filter((r) => hasAnyType(r, SECTION_SOURCE_TYPES)),
    competitorRows: byThread("competitive"),
    competitorSourced: byThread("competitive").filter((r) => sourceUrisOf(r).length > 0),
    managementRows: byThread("management"),
    primarySources: rows.filter((r) => hasAnyType(r, PRIMARY_INSTITUTIONAL_SOURCE_TYPES)),
    hasProducts: !!input.borrowerStory?.products_services?.trim(),
    hasCustomerConcentration: !!input.borrowerStory?.customer_concentration?.trim(),
    hasDscr: [...factKeys].some((k) => /(?:^|_)DSCR$/.test(k)),
    hasRevenue: REVENUE_FACT_KEYS.some((k) => factKeys.has(k)),
    hasArSupport: AR_FACT_KEYS.some((k) => factKeys.has(k)) || collateralDocs.length > 0,
    financialDocs,
    collateralDocs,
    managementProfiles: input.managementProfiles ?? [],
    financialFacts: facts,
  };
}

// ── Link builders ────────────────────────────────────────────────────────────

function claimLinks(rows: EvidenceRowInput[], limit = 4): TaskEvidenceLink[] {
  return rows
    .filter((r) => (r.claim ?? "").trim().length > 0)
    .slice(0, limit)
    .map((r) => ({
      kind: "research_claim" as const,
      id: r.id ?? undefined,
      label: (r.section ?? r.thread_origin ?? "research claim").toString(),
      detail: (r.claim ?? "").trim().slice(0, 140),
    }));
}
function docLinks(docs: DocInput[], limit = 6): TaskEvidenceLink[] {
  return docs.slice(0, limit).map((d) => ({
    kind: "document" as const,
    id: d.id ?? undefined,
    label: (d.canonical_type ?? d.document_type ?? "document").toString(),
    detail: d.original_filename ?? undefined,
  }));
}
function factLinks(keys: string[], facts: FactInput[]): TaskEvidenceLink[] {
  const have = new Set(facts.map((f) => (f.fact_key ?? "").toUpperCase()));
  return keys.filter((k) => have.has(k)).map((k) => ({ kind: "financial_fact" as const, label: k }));
}
function mgmtLinks(profiles: MgmtInput[], limit = 4): TaskEvidenceLink[] {
  return profiles.slice(0, limit).map((m) => ({
    kind: "management_profile" as const,
    id: m.id ?? undefined,
    label: m.person_name ?? "principal",
    detail: m.title ?? undefined,
  }));
}

// ── Coverage checklist (the "paragraph → checklist" transform) ───────────────

export function buildCoverageChecklist(ctx: FileContext): CoverageChecklistItem[] {
  const item = (
    label: string,
    status: EvidenceTaskFileStatus,
    collect_from: string,
    linked_evidence: TaskEvidenceLink[],
    acceptable_evidence: string[],
    linked_sections: string[],
  ): CoverageChecklistItem => ({
    label,
    status,
    collect_from,
    linked_evidence,
    acceptable_evidence,
    linked_sections,
  });

  return [
    item(
      "Products / services",
      ctx.hasProducts ? "collected" : "missing",
      "borrower",
      ctx.hasProducts ? [{ kind: "borrower_story", label: "products_services", detail: "on file" }] : [],
      ["Borrower story products/services", "Borrower-provided description"],
      ["Borrower Profile"],
    ),
    item(
      "DSCR",
      ctx.hasDscr ? "collected" : "missing",
      "spreads",
      factLinks(["DSCR", "GCF_DSCR"], ctx.financialFacts),
      ["Spread-based DSCR", "Global cash flow DSCR"],
      ["Financial Analysis"],
    ),
    item(
      "Financial statements / tax returns",
      ctx.financialDocs.length > 0 ? "collected" : "missing",
      "borrower",
      docLinks(ctx.financialDocs),
      ["Income statement / balance sheet", "Business or personal tax return"],
      ["Financial Analysis"],
    ),
    item(
      "Loan request / use of proceeds",
      "missing",
      "banker",
      [],
      ["Loan request / term sheet", "Stated use of proceeds"],
      ["Borrower Profile"],
    ),
    item(
      "Collateral records",
      ctx.collateralDocs.length > 0 || ctx.hasArSupport ? "collected" : "missing",
      "borrower",
      [...docLinks(ctx.collateralDocs), ...factLinks(AR_FACT_KEYS, ctx.financialFacts)],
      ["AR aging / borrowing base", "Appraisal / collateral schedule"],
      ["Collateral Analysis"],
    ),
    item(
      "Management publicly verified",
      ctx.managementProfiles.length > 0 ? "needs_review" : "missing",
      "official_record",
      mgmtLinks(ctx.managementProfiles, 2),
      ["Public officer/registry record", "Borrower-certified management attestation"],
      ["Management Intelligence"],
    ),
    item(
      "Primary/institutional sources",
      ctx.primarySources.length > 0 ? "collected" : "missing",
      "public_source",
      claimLinks(ctx.primarySources, 3),
      ["Government data (BLS/Census/FRED)", "Secretary-of-state / registry", "Primary news / trade source"],
      ["Industry Overview", "Borrower Profile"],
    ),
  ];
}

// ── Per-task derivation ──────────────────────────────────────────────────────

type Derived = {
  evidence_status: EvidenceTaskFileStatus;
  linked_evidence: TaskEvidenceLink[];
  linked_sections: string[];
  checklist?: CoverageChecklistItem[];
  auto_clear_forbidden?: boolean;
};

function rollupChecklist(items: CoverageChecklistItem[]): EvidenceTaskFileStatus {
  if (items.every((i) => i.status === "collected")) return "collected";
  if (items.some((i) => i.status === "collected" || i.status === "needs_review")) return "needs_review";
  return "missing";
}

function deriveForTask(task: CommitteeEvidenceTask, ctx: FileContext): Derived {
  const type = String(task.task_type);
  const title = String(task.title ?? "");
  const blockerType = String(task.blocker_type ?? "");

  switch (type) {
    case "borrower_website_snapshot":
      return {
        evidence_status: ctx.websiteSources.length > 0 ? "collected" : "missing",
        linked_evidence: ctx.websiteSources.slice(0, 3).map((s) => ({
          kind: "source",
          id: s.id ?? undefined,
          label: "borrower_official_website",
          detail: sourceUrisOf(s)[0] ?? task.target_url ?? undefined,
        })),
        linked_sections: ["Borrower Profile", "Entity Identification"],
      };
    case "sos_business_registry":
      return {
        evidence_status: ctx.registrySources.length > 0 ? "collected" : "missing",
        linked_evidence: claimLinks(ctx.registrySources),
        linked_sections: ["Entity Identification", "Borrower Profile"],
      };
    case "public_adverse_screen":
      return {
        evidence_status: ctx.adverseSources.length > 0 ? "needs_review" : "missing",
        linked_evidence: claimLinks(ctx.adverseSources),
        linked_sections: ["Litigation and Risk"],
      };
    case "management_attestation":
      return {
        evidence_status: ctx.managementProfiles.length > 0 ? "needs_review" : "missing",
        linked_evidence: [...mgmtLinks(ctx.managementProfiles), ...claimLinks(ctx.managementRows)],
        linked_sections: ["Management Intelligence"],
      };
    case "industry_market_source": {
      const linked = [...ctx.industrySources, ...ctx.marketSources];
      return {
        evidence_status: linked.length > 0 ? "collected" : "missing",
        linked_evidence: claimLinks(linked),
        linked_sections: ["Industry Overview", "Market Intelligence"],
      };
    }
    case "competitive_source": {
      const status: EvidenceTaskFileStatus =
        ctx.competitorSourced.length > 0
          ? "collected"
          : ctx.competitorRows.length > 0
            ? "needs_review"
            : "missing";
      return {
        evidence_status: status,
        linked_evidence: claimLinks(ctx.competitorRows),
        linked_sections: ["Competitive Landscape"],
      };
    }
    case "financial_file": {
      const checklist = buildCoverageChecklist(ctx);
      // A scale-plausibility contradiction is routed here (task_type=financial_file)
      // but is a CONTRADICTION — it must never auto-clear and never read as fully
      // resolved off the file alone; cap it at needs_review and forbid auto-clear.
      const isContradiction = blockerType === "contradiction_gap";
      let evidence_status = rollupChecklist(checklist);
      if (isContradiction && evidence_status === "collected") evidence_status = "needs_review";
      return {
        evidence_status,
        linked_evidence: [
          ...docLinks(ctx.financialDocs),
          ...factLinks(["DSCR", "GCF_DSCR", ...REVENUE_FACT_KEYS], ctx.financialFacts),
        ],
        linked_sections: ["Financial Analysis", "Collateral Analysis", "Borrower Profile"],
        checklist,
        ...(isContradiction ? { auto_clear_forbidden: true } : {}),
      };
    }
    case "manual_review":
    default: {
      // Scale-plausibility contradiction → link revenue / AR / DSCR, never auto-clear.
      const isScale = blockerType === "contradiction_gap" && /scale/i.test(title + task.blocker_id);
      if (isScale) {
        const links = factLinks([...REVENUE_FACT_KEYS, "DSCR", "GCF_DSCR", ...AR_FACT_KEYS], ctx.financialFacts);
        if (ctx.hasCustomerConcentration)
          links.push({ kind: "borrower_story", label: "customer_concentration", detail: "on file" });
        const hasSupport = ctx.hasRevenue || ctx.hasDscr || ctx.hasArSupport || ctx.hasCustomerConcentration;
        return {
          evidence_status: hasSupport ? "needs_review" : "missing",
          linked_evidence: links,
          linked_sections: ["Financial Analysis", "Contradictions"],
          auto_clear_forbidden: true,
        };
      }
      return {
        evidence_status: "missing",
        linked_evidence: [],
        linked_sections: [],
        auto_clear_forbidden: blockerType === "contradiction_gap",
      };
    }
  }
}

/** Compose persisted workflow status with the file-derived status for display. */
function resolveStatus(
  persisted: string,
  derived: EvidenceTaskFileStatus,
): EvidenceTaskResolvedStatus {
  if (persisted === "accepted") return "accepted";
  if (persisted === "rejected") return "rejected";
  if (persisted === "collected") return "collected"; // e.g. auto-collected website
  return derived;
}

/**
 * Enrich persisted committee evidence tasks with loan-file linkage + a derived
 * status. Returns NEW task objects (input untouched). Tasks already carry their
 * persisted `status`; we add evidence_status / resolved_status / linked_evidence
 * / linked_sections / checklist.
 */
export function enrichCommitteeTasks(
  tasks: CommitteeEvidenceTask[],
  input: TaskLinkInput,
): CommitteeEvidenceTask[] {
  const ctx = buildContext(input);
  return (tasks ?? []).map((t) => {
    const d = deriveForTask(t, ctx);
    const buckets = deriveTaskItemBuckets({
      checklist: d.checklist,
      title: t.title,
      task_type: t.task_type,
      evidence_status: d.evidence_status,
    });
    return {
      ...t,
      evidence_status: d.evidence_status,
      resolved_status: resolveStatus(String(t.status), d.evidence_status),
      linked_evidence: d.linked_evidence,
      linked_sections: d.linked_sections,
      collected_items: buckets.collected_items,
      missing_items: buckets.missing_items,
      needs_review_items: buckets.needs_review_items,
      ...(d.checklist ? { checklist: d.checklist } : {}),
      ...(d.auto_clear_forbidden ? { auto_clear_forbidden: true } : {}),
    };
  });
}

// ── SPEC-BIE-PERSIST-COMMITTEE-EVIDENCE-TASK-STATUS-1 ────────────────────────
// Pure derivation of the durable item buckets + persisted DB row. Kept pure (no
// server-only / no DB) so persistence and tests share one source of truth.

export type CommitteeTaskItemBuckets = {
  collected_items: string[];
  missing_items: string[];
  needs_review_items: string[];
};

/**
 * Bucket the labels of what this task already has / still needs. For the
 * evidence-coverage task this enumerates the coverage checklist (DSCR /
 * financials / collateral collected, loan request / primary sources missing,
 * management needs_review). For single-status tasks it buckets the task itself.
 */
export function deriveTaskItemBuckets(task: {
  checklist?: CoverageChecklistItem[];
  title?: string | null;
  task_type?: string;
  evidence_status?: EvidenceTaskFileStatus;
}): CommitteeTaskItemBuckets {
  const collected_items: string[] = [];
  const missing_items: string[] = [];
  const needs_review_items: string[] = [];
  const bucketFor = (s: EvidenceTaskFileStatus | undefined) =>
    s === "collected" ? collected_items : s === "needs_review" ? needs_review_items : missing_items;

  if (task.checklist && task.checklist.length > 0) {
    for (const c of task.checklist) bucketFor(c.status).push(c.label);
  } else {
    const label = (task.title ?? task.task_type ?? "").toString().trim();
    if (label) bucketFor(task.evidence_status).push(label);
  }
  return { collected_items, missing_items, needs_review_items };
}

/** The persisted DB row (column → value) for an enriched committee task. */
export type CommitteeTaskPersistRow = {
  resolved_status: EvidenceTaskResolvedStatus | null;
  file_status: EvidenceTaskFileStatus | null;
  linked_evidence: TaskEvidenceLink[];
  coverage_checklist: CoverageChecklistItem[];
  collected_items: string[];
  missing_items: string[];
  needs_review_items: string[];
  auto_clear_forbidden: boolean;
  last_linked_at: string;
};

/**
 * Build the durable persistence row for one enriched task. Never includes the
 * banker workflow `status` column — persistence must not auto-clear a blocker.
 */
export function buildCommitteeTaskPersistRow(
  task: CommitteeEvidenceTask,
  nowIso: string,
): CommitteeTaskPersistRow {
  const buckets = deriveTaskItemBuckets({
    checklist: task.checklist,
    title: task.title,
    task_type: task.task_type,
    evidence_status: task.evidence_status,
  });
  return {
    resolved_status: task.resolved_status ?? null,
    file_status: task.evidence_status ?? null,
    linked_evidence: task.linked_evidence ?? [],
    coverage_checklist: task.checklist ?? [],
    collected_items: buckets.collected_items,
    missing_items: buckets.missing_items,
    needs_review_items: buckets.needs_review_items,
    auto_clear_forbidden: task.auto_clear_forbidden ?? false,
    last_linked_at: nowIso,
  };
}

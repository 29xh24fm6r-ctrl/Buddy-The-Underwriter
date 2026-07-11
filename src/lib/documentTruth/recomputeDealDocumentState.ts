import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { matchDocumentToRequirement } from "./matchDocumentToRequirement";
import {
  getRequirementsForDealType,
  lookupRequirement,
  isRecognizedDealType,
} from "./requirementRegistry";
import type { RequirementCode, RequirementDefinition } from "./requirementRegistry";
import type { ChecklistStatus, ReadinessStatus, ReviewStatus } from "./matchDocumentToRequirement";

type RequirementState = {
  code: RequirementCode;
  label: string;
  group: string;
  required: boolean;
  checklistStatus: ChecklistStatus;
  readinessStatus: ReadinessStatus;
  matchedDocumentIds: string[];
  matchedYears: number[];
  reasons: string[];
};

type Guarantor = { id: string; full_name: string };

type SubjectItem = {
  documentId: string;
  checklistStatus: ChecklistStatus;
  year: number | null;
  subjectId: string | null;
};

// ---------------------------------------------------------------------------
// Multi-document requirement enforcement (quantity / year / subject rules)
// ---------------------------------------------------------------------------

/** Distinct years present, sorted descending. */
function distinctYearsDesc(items: { year: number | null }[]): number[] {
  return [...new Set(items.map((i) => i.year).filter((y): y is number => y != null))].sort(
    (a, b) => b - a,
  );
}

/** True if `years` contains a run of `count` consecutive integers. */
function hasConsecutiveYears(years: number[], count: number): boolean {
  if (count <= 0) return true;
  const sorted = [...new Set(years)].sort((a, b) => b - a);
  if (sorted.length < count) return false;
  for (let start = 0; start <= sorted.length - count; start++) {
    let ok = true;
    for (let k = 0; k < count - 1; k++) {
      if (sorted[start + k] - sorted[start + k + 1] !== 1) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

type QuantityLevel = "complete" | "warning" | "missing";

/**
 * Evaluate one subject's (or, for non-subject-scoped rules, the whole
 * requirement's) documents against requiredCount / yearRule.
 *   complete — enough BANKER-CONFIRMED docs satisfy the rule
 *   warning  — enough docs satisfy the rule, but at least one isn't confirmed
 *   missing  — the rule isn't satisfied even counting unconfirmed docs
 */
function evaluateQuantityAndYear(
  items: SubjectItem[],
  req: RequirementDefinition,
): { level: QuantityLevel; detail: string | null } {
  const confirmed = items.filter((i) => i.checklistStatus === "satisfied");
  // "received" docs count toward the optimistic (warning) check; docs whose
  // checklistStatus is "missing" (e.g. explicitly banker-rejected) contribute
  // to neither — a rejected doc must not count toward satisfying the rule.
  const contributing = items.filter(
    (i) => i.checklistStatus === "satisfied" || i.checklistStatus === "received",
  );

  const meetsRule = (subset: SubjectItem[]): boolean => {
    if (req.quantityRule === "any_one") return subset.length > 0;
    const required = req.requiredCount ?? 1;
    if (req.yearRule === "consecutive") {
      return hasConsecutiveYears(distinctYearsDesc(subset), req.yearCount ?? required);
    }
    return subset.length >= required;
  };

  if (meetsRule(confirmed)) return { level: "complete", detail: null };
  if (meetsRule(contributing)) {
    return { level: "warning", detail: `${req.label}: awaiting banker confirmation` };
  }

  if (req.yearRule === "consecutive") {
    const have = distinctYearsDesc(contributing);
    const need = req.yearCount ?? req.requiredCount ?? 1;
    const detail = have.length > 0
      ? `${req.label}: have ${have.join(", ")} — need ${need} consecutive years`
      : `${req.label}: need ${need} consecutive years`;
    return { level: "missing", detail };
  }

  const required = req.requiredCount ?? 1;
  return {
    level: "missing",
    detail: `${req.label}: have ${contributing.length} of ${required} required`,
  };
}

/**
 * Per-guarantor enforcement (e.g. "PFS from every guarantor", "3 consecutive
 * years of personal tax returns per guarantor"). Zero guarantors on the deal
 * means the requirement simply doesn't apply — it must not permanently block
 * readiness for a deal with no guarantors on record.
 */
function evaluatePerGuarantor(
  items: SubjectItem[],
  req: RequirementDefinition,
  guarantors: Guarantor[],
): { level: QuantityLevel | "not_applicable"; reasons: string[] } {
  if (guarantors.length === 0) {
    return { level: "not_applicable", reasons: [] };
  }

  const reasons: string[] = [];
  let allComplete = true;
  let anyProgress = false;

  for (const g of guarantors) {
    const subset = items.filter((i) => i.subjectId === g.id);
    const result = evaluateQuantityAndYear(subset, req);
    if (result.level !== "complete") {
      allComplete = false;
      reasons.push(
        result.level === "warning"
          ? `${req.label} for ${g.full_name}: awaiting banker confirmation`
          : `${req.label} still needed for ${g.full_name}`,
      );
    }
    if (result.level !== "missing") anyProgress = true;
  }

  if (allComplete) return { level: "complete", reasons: [] };
  if (anyProgress) return { level: "warning", reasons };
  return { level: "missing", reasons };
}

type DealDocumentSnapshot = {
  requirementState: RequirementState[];
  readiness: {
    totalRequired: number;
    satisfied: number;
    missing: number;
    pct: number;
  };
  blockers: Array<{
    requirementCode: string;
    label: string;
    reason: string;
  }>;
};

/**
 * Master recompute pipeline for deal document state.
 * Triggered on every document event (upload, classify, confirm, reject, reclassify).
 *
 * Steps:
 * 1. Load all documents for deal
 * 2. Match each doc to requirement code
 * 3. Upsert ledger rows
 * 4. Aggregate requirement satisfaction
 * 5. Compute readiness + blockers
 * 6. Persist snapshot
 */
export async function recomputeDealDocumentState(dealId: string): Promise<void> {
  const sb = supabaseAdmin();

  // Step 1: Load deal + documents
  const { data: deal } = await sb
    .from("deals")
    .select("id, deal_type, bank_id")
    .eq("id", dealId)
    .single();

  if (!deal) return;

  const { data: documents } = await sb
    .from("deal_documents")
    .select("id, deal_id, original_filename, checklist_key, canonical_type, ai_doc_type, ai_confidence, doc_year, ai_tax_year, assigned_owner_id, intake_status, intake_confirmed_at, created_at")
    .eq("deal_id", dealId);

  // Auto-satisfy loan_request.summary when a structured loan request record exists
  const { data: loanRequestRecord } = await sb
    .from("deal_loan_requests")
    .select("id")
    .eq("deal_id", dealId)
    .limit(1)
    .maybeSingle();

  // Guarantors: deal_owners flagged as requiring a personal package (20%+
  // owners) are the canonical subject set for "per_guarantor" requirements
  // (personal tax returns, PFS). Zero guarantors on record means those
  // requirements simply don't apply — they must not permanently block
  // readiness for a deal with no guarantors on file.
  const { data: guarantorRows } = await sb
    .from("deal_owners")
    .select("id, full_name")
    .eq("deal_id", dealId)
    .eq("requires_personal_package", true);
  const guarantors = (guarantorRows ?? []) as Guarantor[];

  // Preserve banker rejections across recompute: a rejection is a distinct,
  // explicit action (POST .../reject) that must survive until the banker
  // explicitly un-rejects it (confirm/reclassify) — not silently reset just
  // because this function rebuilds deal_document_items from scratch below.
  const { data: existingItemStatuses } = await sb
    .from("deal_document_items")
    .select("document_id, review_status")
    .eq("deal_id", dealId);
  const rejectedDocumentIds = new Set(
    (existingItemStatuses ?? [])
      .filter((it: any) => it.review_status === "rejected")
      .map((it: any) => it.document_id as string),
  );

  const dealType = (deal as Record<string, unknown>).deal_type as string ?? "conventional";
  const requirements = getRequirementsForDealType(dealType);

  if (!isRecognizedDealType(dealType)) {
    void writeEvent({
      dealId,
      kind: "documentTruth.unknown_deal_type",
      scope: "intake",
      requiresHumanReview: true,
      meta: {
        deal_type: dealType,
        detail: "Deal type not recognized by requirementRegistry — only dealTypes:['all'] requirements applied; deal-type-specific requirements (e.g. CRE collateral) may be undetermined.",
      },
    });
  }

  // Step 2: Match each document to requirement
  const matchedItems: Array<{
    documentId: string;
    requirementCode: RequirementCode | null;
    checklistStatus: ChecklistStatus;
    readinessStatus: ReadinessStatus;
    classifiedType: string | null;
    year: number | null;
    subjectId: string | null;
    sourceFileName: string | null;
    reviewStatus: ReviewStatus;
    reasons: string[];
  }> = [];

  for (const doc of (documents ?? []) as Array<Record<string, unknown>>) {
    // canonical_type is the authoritative source — it is updated by manual corrections.
    // ai_doc_type is raw AI output and is never overwritten by the correction pipeline.
    const classifiedType = (doc.canonical_type as string) ?? (doc.ai_doc_type as string) ?? null;

    // Prefer DB year fields (set by classification/correction pipeline), fall back to filename parsing
    const yearFromDb = (doc.doc_year as number) ?? (doc.ai_tax_year ? parseInt(doc.ai_tax_year as string, 10) : null);
    const yearMatch = !yearFromDb ? (doc.original_filename as string)?.match(/(?:^|[^0-9])(20[0-3][0-9])(?:[^0-9]|$)/) : null;
    const year = yearFromDb ?? (yearMatch ? parseInt(yearMatch[1], 10) : null);

    // Derive reviewStatus from intake pipeline:
    // "LOCKED_FOR_PROCESSING" means banker approved the doc for the pipeline → "confirmed"
    // A prior explicit banker rejection (deal_document_items.review_status)
    // takes precedence over the intake pipeline's own status — it stays
    // rejected until the banker explicitly un-rejects it.
    // All other statuses → "unreviewed"
    const isRejected = rejectedDocumentIds.has(doc.id as string);
    const reviewStatus: ReviewStatus = isRejected
      ? "rejected"
      : (doc.intake_status as string) === "LOCKED_FOR_PROCESSING"
        ? "confirmed"
        : "unreviewed";

    const result = matchDocumentToRequirement({
      classifiedType,
      year,
      subjectId: (doc.assigned_owner_id as string) ?? null,
      partyScope: "business",
      reviewStatus,
    });

    // A rejected document does not satisfy its requirement at all — it must
    // not count toward "received"/"satisfied" aggregation below.
    const checklistStatus: ChecklistStatus = isRejected ? "missing" : result.checklistStatus;
    const readinessStatus: ReadinessStatus = isRejected ? "blocking" : result.readinessStatus;
    const reasons = isRejected
      ? [...result.reasons, "Document rejected by banker — does not satisfy this requirement"]
      : result.reasons;

    matchedItems.push({
      documentId: doc.id as string,
      requirementCode: result.requirementCode,
      checklistStatus,
      readinessStatus,
      classifiedType,
      year,
      subjectId: (doc.assigned_owner_id as string) ?? null,
      sourceFileName: (doc.original_filename as string) ?? null,
      reviewStatus,
      reasons,
    });
  }

  if (loanRequestRecord) {
    matchedItems.push({
      documentId: loanRequestRecord.id,
      requirementCode: "loan_request.summary" as RequirementCode,
      checklistStatus: "satisfied",
      readinessStatus: "complete",
      classifiedType: "loan_request",
      year: null,
      subjectId: null,
      reasons: [],
      sourceFileName: "Structured Loan Request",
      reviewStatus: "confirmed",
    });
  }

  // Step 3: Upsert ledger rows
  // Delete existing items for this deal, then re-insert
  await sb.from("deal_document_items").delete().eq("deal_id", dealId);

  const ledgerRows = matchedItems
    .filter((m) => m.requirementCode)
    .map((m) => ({
      deal_id: dealId,
      document_id: m.documentId,
      requirement_code: m.requirementCode!,
      requirement_group: lookupRequirement(m.requirementCode!)?.group ?? null,
      canonical_doc_type: m.classifiedType,
      year: m.year,
      party_scope: "business",
      subject_id: m.subjectId,
      uploaded_at: new Date().toISOString(),
      classified_at: m.classifiedType ? new Date().toISOString() : null,
      classified_type: m.classifiedType,
      review_status: m.reviewStatus,
      validation_status: "pending",
      checklist_status: m.checklistStatus,
      readiness_status: m.readinessStatus,
      source_file_name: m.sourceFileName,
    }));

  // Also insert rows for missing requirements
  const matchedCodes = new Set(matchedItems.map((m) => m.requirementCode).filter(Boolean));
  for (const req of requirements) {
    if (!matchedCodes.has(req.code)) {
      ledgerRows.push({
        deal_id: dealId,
        document_id: null as any,
        requirement_code: req.code,
        requirement_group: req.group,
        canonical_doc_type: null,
        year: null,
        party_scope: req.subjectRule === "business" ? "business" : "business",
        subject_id: null,
        uploaded_at: null as any,
        classified_at: null,
        classified_type: null,
        review_status: "unreviewed",
        validation_status: "pending",
        checklist_status: "missing" as const,
        readiness_status: req.required ? "blocking" as const : "optional" as const,
        source_file_name: null,
      });
    }
  }

  if (ledgerRows.length > 0) {
    await sb.from("deal_document_items").insert(ledgerRows);
  }

  // Step 4: Aggregate requirement satisfaction
  //
  // Three-way status per requirement:
  //   complete — enough BANKER-CONFIRMED docs satisfy it (incl. quantity/year/subject rules)
  //   warning  — docs are present that WOULD satisfy it, but aren't confirmed yet
  //   missing  — not satisfied even by unconfirmed docs
  // "warning" must never collapse into "complete" — an auto-classified but
  // banker-unconfirmed required document must keep blocking readiness until
  // the banker confirms it.
  const reqState: RequirementState[] = requirements.map((req) => {
    const items = matchedItems.filter((m) => m.requirementCode === req.code);
    const usesMultiDocRules =
      req.subjectRule === "per_guarantor" ||
      (req.requiredCount != null && req.requiredCount > 1) ||
      req.yearRule != null;

    let checklistStatus: ChecklistStatus;
    let readinessStatus: ReadinessStatus;
    let extraReasons: string[] = [];

    if (req.subjectRule === "per_guarantor") {
      const result = evaluatePerGuarantor(items, req, guarantors);
      if (result.level === "not_applicable") {
        // No guarantors on this deal — the requirement can't apply. Waived,
        // not blocking (fix for zero-guarantor deals never being satisfiable).
        checklistStatus = "waived";
        readinessStatus = "optional";
      } else if (result.level === "complete") {
        checklistStatus = "satisfied";
        readinessStatus = "complete";
      } else if (result.level === "warning") {
        checklistStatus = "received";
        readinessStatus = "warning";
      } else {
        checklistStatus = "missing";
        readinessStatus = req.required ? "blocking" : "optional";
      }
      extraReasons = result.reasons;
    } else if (usesMultiDocRules) {
      const result = evaluateQuantityAndYear(items, req);
      if (result.level === "complete") {
        checklistStatus = "satisfied";
        readinessStatus = "complete";
      } else if (result.level === "warning") {
        checklistStatus = "received";
        readinessStatus = "warning";
      } else {
        checklistStatus = "missing";
        readinessStatus = req.required ? "blocking" : "optional";
      }
      if (result.detail) extraReasons = [result.detail];
    } else {
      const anySatisfied = items.some((i) => i.checklistStatus === "satisfied");
      const anyReceived = items.some(
        (i) => i.checklistStatus === "received" || i.checklistStatus === "satisfied",
      );
      checklistStatus = anySatisfied ? "satisfied" : anyReceived ? "received" : "missing";
      readinessStatus = anySatisfied
        ? "complete"
        : anyReceived
          ? "warning"
          : req.required
            ? "blocking"
            : "optional";
    }

    return {
      code: req.code,
      label: req.label,
      group: req.group,
      required: req.required,
      checklistStatus,
      readinessStatus,
      matchedDocumentIds: items.map((i) => i.documentId),
      matchedYears: items.filter((i) => i.year).map((i) => i.year!).sort(),
      reasons: [...items.flatMap((i) => i.reasons), ...extraReasons],
    };
  });

  // Step 5: Readiness + blockers
  const totalRequired = reqState.filter((r) => r.required).length;
  // Only banker-CONFIRMED requirements count toward "satisfied" — an
  // unconfirmed (warning) requirement must not read as done. "waived" (e.g.
  // a per_guarantor requirement with zero guarantors on the deal) counts as
  // satisfied — it's vacuously true, consistent with computeReadinessAndBlockers'
  // existing satisfiedRequired convention (checklistStatus 'satisfied' | 'waived').
  const satisfied = reqState.filter(
    (r) => r.required && (r.checklistStatus === "satisfied" || r.checklistStatus === "waived"),
  ).length;

  const blockers = reqState
    .filter((r) => r.required && (r.readinessStatus === "blocking" || r.readinessStatus === "warning"))
    .map((r) => ({
      requirementCode: r.code,
      label: r.label,
      reason: r.matchedDocumentIds.length === 0
        ? `Missing: ${r.label}`
        : r.reasons.join("; ") ||
          (r.readinessStatus === "warning"
            ? `${r.label}: pending banker confirmation`
            : `${r.label}: not yet satisfied`),
    }));

  const snapshot: DealDocumentSnapshot = {
    requirementState: reqState,
    readiness: {
      totalRequired,
      satisfied,
      missing: totalRequired - satisfied,
      pct: totalRequired > 0 ? Math.round((satisfied / totalRequired) * 100) : 0,
    },
    blockers,
  };

  // Step 6: Persist snapshot
  await sb
    .from("deal_document_snapshots")
    .upsert({
      deal_id: dealId,
      requirement_state: snapshot.requirementState,
      readiness: snapshot.readiness,
      blockers: snapshot.blockers,
      computed_at: new Date().toISOString(),
    }, { onConflict: "deal_id" });
}

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { matchDocumentToRequirement } from "./matchDocumentToRequirement";
import { getRequirementsForDealType, lookupRequirement } from "./requirementRegistry";
import type { RequirementCode } from "./requirementRegistry";
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

  const dealType = (deal as Record<string, unknown>).deal_type as string ?? "conventional";
  const requirements = getRequirementsForDealType(dealType);

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
    // "LOCKED_FOR_PROCESSING" with intake_confirmed_at set → banker confirmed → "confirmed"
    // "LOCKED_FOR_PROCESSING" without intake_confirmed_at → auto-locked → "unreviewed"
    // All other statuses → "unreviewed"
    const reviewStatus: ReviewStatus =
      (doc.intake_status as string) === "LOCKED_FOR_PROCESSING" && doc.intake_confirmed_at
        ? "confirmed"
        : "unreviewed";

    const result = matchDocumentToRequirement({
      classifiedType,
      year,
      subjectId: (doc.assigned_owner_id as string) ?? null,
      partyScope: "business",
      reviewStatus,
    });

    matchedItems.push({
      documentId: doc.id as string,
      requirementCode: result.requirementCode,
      checklistStatus: result.checklistStatus,
      readinessStatus: result.readinessStatus,
      classifiedType,
      year,
      subjectId: (doc.assigned_owner_id as string) ?? null,
      sourceFileName: (doc.original_filename as string) ?? null,
      reviewStatus,
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
  const reqState: RequirementState[] = requirements.map((req) => {
    const items = matchedItems.filter((m) => m.requirementCode === req.code);
    const satisfied = items.some(
      (i) => i.checklistStatus === "satisfied" || i.checklistStatus === "received",
    );

    return {
      code: req.code,
      label: req.label,
      group: req.group,
      required: req.required,
      checklistStatus: satisfied ? "received" : "missing",
      readinessStatus: satisfied ? "complete" : req.required ? "blocking" : "optional",
      matchedDocumentIds: items.map((i) => i.documentId),
      matchedYears: items.filter((i) => i.year).map((i) => i.year!).sort(),
      reasons: items.flatMap((i) => {
        const result = matchDocumentToRequirement({
          classifiedType: i.classifiedType,
          year: i.year,
          subjectId: i.subjectId,
          partyScope: "business",
          reviewStatus: i.reviewStatus,
        });
        return result.reasons;
      }),
    };
  });

  // Step 5: Readiness + blockers
  const totalRequired = reqState.filter((r) => r.required).length;
  const satisfied = reqState.filter(
    (r) => r.required && (r.checklistStatus === "received" || r.checklistStatus === "satisfied"),
  ).length;

  const blockers = reqState
    .filter((r) => r.required && r.readinessStatus === "blocking")
    .map((r) => ({
      requirementCode: r.code,
      label: r.label,
      reason: r.matchedDocumentIds.length === 0
        ? `Missing: ${r.label}`
        : r.reasons.join("; ") || `${r.label}: not yet satisfied`,
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

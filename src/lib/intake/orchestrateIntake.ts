import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { seedIntakePrereqsCore } from "@/lib/intake/seedIntakePrereqsCoreImpl";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { normalizeGoogleError } from "@/lib/google/errors";
import { advanceDealLifecycle } from "@/lib/deals/advanceDealLifecycle";
import { isOpenAiGatekeeperEnabled } from "@/lib/flags/openaiGatekeeper";
import { classifyDocumentSpine } from "@/lib/classification/classifyDocumentSpine";
import { resolveDocTyping } from "@/lib/docs/typing/resolveDocTyping";
import { extractBorrowerFromDocs } from "@/lib/borrower/extractBorrowerFromDocs";
import { extractPrincipalsFromDocs } from "@/lib/principals/extractPrincipalsFromDocs";
import { buildFinancialSnapshot } from "@/lib/financials/buildFinancialSnapshot";

export type OrchestrateIntakeResult = {
  ok: boolean;
  dealId: string;
  bankId: string;
  diagnostics: { steps: Array<{ name: string; ok: boolean; status?: string; error?: string }> };
  borrowerDetected?: boolean;
  principalsDetected?: boolean;
  financialSnapshot?: "created" | "already_present" | "missing";
  lifecycleAdvanced?: boolean;
};

async function logLedgerOnce(args: {
  sb: ReturnType<typeof supabaseAdmin>;
  dealId: string;
  bankId: string;
  eventKey: string;
  uiMessage: string;
  meta?: Record<string, unknown> | null;
}) {
  const { sb, dealId, bankId, eventKey, uiMessage, meta } = args;
  const { data: existing } = await sb
    .from("deal_pipeline_ledger")
    .select("id")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("event_key", eventKey)
    .limit(1)
    .maybeSingle();

  if (existing?.id) return false;
  await logLedgerEvent({
    dealId,
    bankId,
    eventKey,
    uiState: "done",
    uiMessage,
    meta: meta ?? undefined,
  });
  return true;
}

async function ensureDocumentClassification(args: { dealId: string; bankId: string }) {
  const sb = supabaseAdmin();
  const { data: docs } = await sb
    .from("deal_documents")
    .select("id, canonical_type, document_type, original_filename, mime_type, doc_year")
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId);

  const missing = (docs ?? []).filter(
    (d: any) => !d.canonical_type || d.canonical_type === "unknown",
  );
  if (!missing.length) return "already_classified";

  const docIds = missing.map((d: any) => String(d.id));
  const { data: ocrRows } = await sb
    .from("document_ocr_results")
    .select("attachment_id, extracted_text")
    .eq("deal_id", args.dealId)
    .in("attachment_id", docIds)
    .limit(50);

  const ocrByDoc = new Map<string, string>();
  for (const row of ocrRows ?? []) {
    const id = String((row as any).attachment_id || "");
    const text = String((row as any).extracted_text || "");
    if (id && text) ocrByDoc.set(id, text);
  }

  let updated = 0;
  for (const doc of missing) {
    const docId = String(doc.id);
    const text = ocrByDoc.get(docId) || "";
    if (!text) continue;

    const spine = await classifyDocumentSpine(
      text,
      (doc as any).original_filename || "",
      (doc as any).mime_type || null,
    );

    const typing = resolveDocTyping({
      aiDocType: spine.docType,
      aiFormNumbers: spine.formNumbers ?? null,
      aiConfidence: spine.confidence,
      aiTaxYear: spine.taxYear ?? null,
      aiEntityType: spine.entityType ?? null,
    });

    const res = await sb
      .from("deal_documents")
      .update({
        canonical_type: typing.canonical_type,
        document_type: typing.document_type,
        routing_class: typing.routing_class,
        checklist_key: typing.checklist_key,
        classification_confidence: spine.confidence,
        match_source: "spine",
        match_reason: spine.reason,
        doc_year: spine.taxYear ?? (doc as any).doc_year ?? null,
      })
      .eq("id", docId);

    if (!res.error) updated += 1;
  }

  return `updated_${updated}`;
}

export async function orchestrateIntake(args: {
  dealId: string;
  bankId: string;
  source?: "banker" | "builder" | "system";
}): Promise<OrchestrateIntakeResult> {
  const sb = supabaseAdmin();
  const diagnostics: OrchestrateIntakeResult["diagnostics"] = { steps: [] };
  const source = args.source ?? "system";

  const step = async (name: string, fn: () => Promise<string | undefined>) => {
    try {
      const status = await fn();
      diagnostics.steps.push({ name, ok: true, status });
    } catch (e: any) {
      const normalized = normalizeGoogleError(e);
      diagnostics.steps.push({ name, ok: false, error: String(e?.message ?? e) });
      if (normalized.code === "GOOGLE_UNKNOWN") {
        await logLedgerOnce({
          sb,
          dealId: args.dealId,
          bankId: args.bankId,
          eventKey: "deal.intake.retrying",
          uiMessage: "Intake retrying",
          meta: { source, error_code: normalized.code, error_message: normalized.message },
        });
      }
    }
  };

  await step("ensure_checklist_seeded", async () => {
    const seed = await seedIntakePrereqsCore({
      dealId: args.dealId,
      bankId: args.bankId,
      source: source === "builder" ? "builder" : "banker",
      ensureBorrower: false,
      ensureFinancialSnapshot: false,
      setStageCollecting: true,
    });

    await logLedgerOnce({
      sb,
      dealId: args.dealId,
      bankId: args.bankId,
      eventKey: "deal.checklist.seeded",
      uiMessage: "Checklist seeded",
      meta: { source },
    });

    return seed?.stage ?? "seeded";
  });

  await step("gatekeeper_classify", async () => {
    if (!isOpenAiGatekeeperEnabled()) return "skipped_or_disabled";
    const { runGatekeeperBatch } = await import("@/lib/gatekeeper/runGatekeeperBatch");
    const batch = await runGatekeeperBatch({
      dealId: args.dealId,
      bankId: args.bankId,
    });
    if (batch.total === 0) return "no_docs";

    await logLedgerOnce({
      sb,
      dealId: args.dealId,
      bankId: args.bankId,
      eventKey: "deal.gatekeeper.completed",
      uiMessage: `Gatekeeper classified ${batch.classified}/${batch.total} documents`,
      meta: {
        source,
        total: batch.total,
        classified: batch.classified,
        cached: batch.cached,
        needs_review: batch.needs_review,
        errors: batch.errors,
      },
    });

    return `classified_${batch.classified}_of_${batch.total}`;
  });

  await step("classify_documents", async () => {
    const status = await ensureDocumentClassification({ dealId: args.dealId, bankId: args.bankId });
    return status;
  });

  let borrowerDetected = false;
  await step("extract_borrower", async () => {
    const { data: deal } = await sb
      .from("deals")
      .select("id, borrower_id, borrower_name, entity_type")
      .eq("id", args.dealId)
      .eq("bank_id", args.bankId)
      .maybeSingle();

    if (!deal) return "deal_not_found";
    if (deal.borrower_id) {
      borrowerDetected = true;
      return "already_attached";
    }

    const extracted = await extractBorrowerFromDocs({ dealId: args.dealId, bankId: args.bankId });
    if (!extracted?.legalName || !extracted?.entityType) {
      return "no_signal";
    }

    const { data: borrower, error } = await sb
      .from("borrowers")
      .insert({
        bank_id: args.bankId,
        legal_name: extracted.legalName,
        entity_type: extracted.entityType,
        ein: extracted.einMasked,
        primary_contact_name: null,
        primary_contact_email: null,
      })
      .select("id, legal_name")
      .single();

    if (error || !borrower) {
      throw error ?? new Error("borrower_insert_failed");
    }

    await sb
      .from("deals")
      .update({
        borrower_id: borrower.id,
        borrower_name: borrower.legal_name ?? extracted.legalName,
        entity_type: extracted.entityType,
        updated_at: new Date().toISOString(),
      })
      .eq("id", args.dealId)
      .eq("bank_id", args.bankId);

    borrowerDetected = true;

    await logLedgerOnce({
      sb,
      dealId: args.dealId,
      bankId: args.bankId,
      eventKey: "deal.borrower.detected",
      uiMessage: "Borrower detected from documents",
      meta: {
        source,
        confidence: extracted.confidence,
        source_doc_id: extracted.sourceDocId,
      },
    });

    return "created";
  });

  let principalsDetected = false;
  await step("extract_principals", async () => {
    const extracted = await extractPrincipalsFromDocs(args.dealId);

    if (!extracted.principals.length) {
      return "none_found";
    }

    const { data: existing } = await sb
      .from("deal_entities")
      .select("id, name")
      .eq("deal_id", args.dealId)
      .eq("entity_kind", "PERSON");

    const existingNames = new Set((existing ?? []).map((e: any) => String(e.name || "").toLowerCase()));

    for (const p of extracted.principals) {
      if (!p.fullName || existingNames.has(p.fullName.toLowerCase())) continue;
      await sb.from("deal_entities").insert({
        deal_id: args.dealId,
        user_id: "system",
        name: p.fullName,
        entity_kind: "PERSON",
        legal_name: p.fullName,
        ownership_percent: p.ownershipPercentage,
        notes: p.role ?? null,
        meta: { source: "doc_extract", source_doc_id: p.sourceDocId },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    principalsDetected = true;

    await logLedgerOnce({
      sb,
      dealId: args.dealId,
      bankId: args.bankId,
      eventKey: "deal.principals.detected",
      uiMessage: "Principals detected from documents",
      meta: {
        source,
        count: extracted.principals.length,
        total_ownership: extracted.totalOwnership,
        coverage: extracted.coverageStatus,
      },
    });

    return `found_${extracted.principals.length}`;
  });

  let financialSnapshot: OrchestrateIntakeResult["financialSnapshot"] = "missing";
  await step("ensure_financial_snapshot", async () => {
    const { data: deal } = await sb
      .from("deals")
      .select("entity_type")
      .eq("id", args.dealId)
      .eq("bank_id", args.bankId)
      .maybeSingle();

    const result = await buildFinancialSnapshot({
      dealId: args.dealId,
      bankId: args.bankId,
      borrowerEntityType: (deal as any)?.entity_type ?? null,
    });

    financialSnapshot = result.status;

    if (result.status === "created") {
      await logLedgerOnce({
        sb,
        dealId: args.dealId,
        bankId: args.bankId,
        eventKey: "deal.financials.snapshot_created",
        uiMessage: "Financial snapshot created",
        meta: { source, snapshot_id: result.snapshotId ?? null },
      });
    }

    return result.status;
  });

  let lifecycleAdvanced = false;
  await step("advance_lifecycle", async () => {
    const { data: deal } = await sb
      .from("deals")
      .select("stage")
      .eq("id", args.dealId)
      .eq("bank_id", args.bankId)
      .maybeSingle();

    if (!deal) return "deal_not_found";
    if (deal.stage === "collecting") return "already_collecting";

    await advanceDealLifecycle({
      dealId: args.dealId,
      toStage: "collecting",
      reason: "intake_orchestrator",
      source: "intake",
      actor: { userId: null, type: "system", label: "intake_orchestrator" },
    });

    lifecycleAdvanced = true;

    await logLedgerOnce({
      sb,
      dealId: args.dealId,
      bankId: args.bankId,
      eventKey: "deal.lifecycle.advanced",
      uiMessage: "Lifecycle advanced",
      meta: { source, to_stage: "collecting" },
    });

    return "advanced";
  });

  return {
    ok: true,
    dealId: args.dealId,
    bankId: args.bankId,
    diagnostics,
    borrowerDetected,
    principalsDetected,
    financialSnapshot,
    lifecycleAdvanced,
  };
}

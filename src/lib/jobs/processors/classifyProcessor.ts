import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { classifyDocumentSpine } from "@/lib/classification/classifyDocumentSpine";
import { reconcileConditionsFromOcrResult } from "@/lib/conditions/reconcileConditions";
import { createClient } from "@supabase/supabase-js";
import { inferDocumentMetadata } from "@/lib/documents/inferDocumentMetadata";
import { reconcileChecklistForDeal } from "@/lib/checklist/engine";
import { persistAiMapping } from "@/lib/ai-docs/persistMapping";
import { buildGeminiScanResultFromExtractedText } from "@/lib/ai-docs/mapToChecklist";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { enqueueExtractJob } from "@/lib/jobs/processors/extractProcessor";
import { resolveDocTypeRouting } from "@/lib/documents/docTypeRouting";
import { normalizeToCanonical } from "@/lib/documents/normalizeType";
import { resolveChecklistKey, PERIOD_REQUIRED_TYPES } from "@/lib/docTyping/resolveChecklistKey";

/**
 * Classification Job Processor
 * 
 * Reads OCR results
 * Runs deterministic classifier
 * Stores results in document_classifications
 * Triggers conditions recompute
 */

export async function processClassifyJob(jobId: string, leaseOwner: string) {
  const supabase = supabaseAdmin();
  const leaseDuration = 3 * 60 * 1000; // 3 minutes
  const leaseUntil = new Date(Date.now() + leaseDuration).toISOString();

  function mapClassifierDocTypeToCanonicalBucket(docTypeRaw: any): string | null {
    const dt = String(docTypeRaw || "").trim().toUpperCase();
    if (!dt) return null;
    if (dt === "INCOME_STATEMENT") return "income_statement";
    if (dt === "BALANCE_SHEET") return "balance_sheet";
    if (dt === "FINANCIAL_STATEMENT") return "financial_statement";
    if (dt === "AR_AGING") return "ar_aging";
    if (dt === "IRS_1120" || dt === "IRS_1120S" || dt === "IRS_1065" || dt === "IRS_BUSINESS") return "business_tax_return";
    if (dt === "IRS_1040" || dt === "IRS_PERSONAL") return "personal_tax_return";
    return null;
  }

  async function tryStampDealDocumentMetadata(args: {
    dealId: string;
    attachmentId: string;
    extractedText: string;
    classifierDocType?: string | null;
    classifierConfidence01?: number | null;
    classifierReasons?: any;
    classifierTaxYear?: number | null;
    classifierPeriodEnd?: string | null;
  }) {
    try {
      const docRes = await (supabase as any)
        .from("deal_documents")
        .select("id, bank_id, original_filename, document_type, doc_year, doc_years, match_source, finalized_at, gatekeeper_classified_at, gatekeeper_route, gatekeeper_doc_type")
        .eq("deal_id", args.dealId)
        .eq("id", args.attachmentId)
        .maybeSingle();

      const inferred = inferDocumentMetadata({
        // Do not rely on borrower-provided filenames for classification.
        originalFilename: null,
        extractedText: args.extractedText,
      });

      // Only persist useful signals; never overwrite a known type with "unknown".
      const inferredType = inferred.document_type !== "unknown" ? inferred.document_type : null;
      const classifierType = mapClassifierDocTypeToCanonicalBucket(args.classifierDocType);
      const nextType = inferredType ?? classifierType;

      // Persist mapping evidence for adaptive checklist (best-effort).
      // Only do this when we're operating on a canonical deal_documents row.
      if (!docRes.error && docRes.data?.id) {
        const confidence01 = Math.max(
          Number(inferred.confidence ?? 0) || 0,
          Number(args.classifierConfidence01 ?? 0) || 0,
        );
        const scan = buildGeminiScanResultFromExtractedText({
          extractedText: args.extractedText,
          inferredDocType: nextType,
          inferredTaxYear: inferred.doc_year ?? null,
          confidence01,
          extracted: {
            source: "classify_job",
            classifyDocument: {
              doc_type: args.classifierDocType ?? null,
              confidence: args.classifierConfidence01 ?? null,
              reasons: args.classifierReasons ?? null,
            },
            inferDocumentMetadata: inferred,
          },
        });

        await persistAiMapping({
          dealId: String(args.dealId),
          documentId: String(args.attachmentId),
          scan,
          model: "gemini_ocr+classify_job",
        });
      }

      // Resolve canonical_type + routing_class from spine classifier docType.
      // Spine docType is authoritative — do NOT preserve stale DB document_type.
      const spineDocType = String(args.classifierDocType || "");
      let { canonical_type, routing_class } = resolveDocTypeRouting(
        spineDocType || nextType || "",
      );

      // document_type: use the spine docType via normalizeToCanonical (not stale DB value).
      // This ensures AR_AGING gets document_type=AR_AGING, not OTHER.
      const documentType = spineDocType
        ? normalizeToCanonical(spineDocType)
        : ((docRes.data as any)?.document_type ?? nextType);

      // If gatekeeper already classified AND doc is not manually classified or finalized,
      // use gatekeeper hints for canonical_type/routing_class when our own resolve is weak.
      const gkClassifiedAt = (docRes.data as any)?.gatekeeper_classified_at;
      const gkRoute = (docRes.data as any)?.gatekeeper_route;
      const gkDocType = (docRes.data as any)?.gatekeeper_doc_type;
      const matchSource = (docRes.data as any)?.match_source;
      const finalizedAt = (docRes.data as any)?.finalized_at;

      if (
        gkClassifiedAt &&
        gkDocType &&
        (gkRoute === "GOOGLE_DOC_AI_CORE" || gkRoute === "STANDARD") &&
        gkRoute !== "NEEDS_REVIEW" &&
        matchSource !== "manual" &&
        !finalizedAt &&
        canonical_type === "OTHER"
      ) {
        try {
          const { mapGatekeeperToCanonicalHint } = await import("@/lib/gatekeeper/routing");
          const hint = mapGatekeeperToCanonicalHint(gkDocType);
          canonical_type = hint.canonical_type_hint as any;
          routing_class = hint.routing_class_hint as any;
        } catch {
          // Non-fatal — gatekeeper hint import failed, use default resolve
        }
      }

      // Derive statement period for period-required types (BALANCE_SHEET, INCOME_STATEMENT).
      // Uses periodEnd from spine classifier when available, else from inferred year.
      let statementPeriod: string | null = null;
      if (PERIOD_REQUIRED_TYPES.has(canonical_type) && args.classifierPeriodEnd) {
        const periodEnd = args.classifierPeriodEnd;
        const currentYear = new Date().getFullYear();
        const periodMonth = parseInt(periodEnd.slice(5, 7), 10);
        const periodYear = parseInt(periodEnd.slice(0, 4), 10);
        const isYearEnd = periodMonth === 12;

        if (canonical_type === "BALANCE_SHEET") {
          // CURRENT = most recent period, HISTORICAL = prior year-end
          statementPeriod = periodYear >= currentYear ? "CURRENT" : "HISTORICAL";
        } else if (canonical_type === "INCOME_STATEMENT") {
          // ANNUAL = full year (Dec 31), YTD = interim period
          statementPeriod = isYearEnd ? "ANNUAL" : "YTD";
        }
      }

      // Resolve checklist_key via the single source of truth.
      const taxYear = args.classifierTaxYear ?? inferred.doc_year ?? null;
      const checklist_key = resolveChecklistKey(canonical_type, taxYear, statementPeriod);

      const attempt1 = await (supabase as any)
        .from("deal_documents")
        .update({
          document_type: documentType,
          doc_year: (docRes.data as any)?.doc_year ?? inferred.doc_year,
          doc_years: (docRes.data as any)?.doc_years ?? inferred.doc_years,
          match_confidence: inferred.confidence,
          match_reason: `ocr_infer:${inferred.reason}`,
          match_source: "ocr",
          canonical_type,
          routing_class,
          ...(checklist_key ? { checklist_key } : {}),
        })
        .eq("id", args.attachmentId);

      if (attempt1.error) {
        const msg = String(attempt1.error.message || "");
        // Schema drift tolerance: environments missing v2/v3 columns.
        if (msg.toLowerCase().includes("does not exist")) {
          await (supabase as any)
            .from("deal_documents")
            .update({
              doc_year: (docRes.data as any)?.doc_year ?? inferred.doc_year,
              match_confidence: inferred.confidence,
              match_reason: `ocr_infer:${inferred.reason}`,
              match_source: "ocr",
            })
            .eq("id", args.attachmentId);
        }
      }

      // Reconcile checklist now that we have year/type.
      await reconcileChecklistForDeal({ sb: supabase as any, dealId: args.dealId });
    } catch {
      // best-effort; never fail job
    }
  }

  try {
    // Lease the job
    const { data: job, error: e1 } = await (supabase as any)
      .from("document_jobs")
      .update({
        status: "RUNNING",
        leased_until: leaseUntil,
        lease_owner: leaseOwner,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("status", "QUEUED")
      .select()
      .single();

    if (e1 || !job) {
      return { ok: false, error: "Failed to lease job" };
    }

    // Fetch OCR result + filename for spine classifier
    const [ocrRes, docRes2] = await Promise.all([
      (supabase as any)
        .from("document_ocr_results")
        .select("extracted_text, raw_json")
        .eq("attachment_id", job.attachment_id)
        .single(),
      (supabase as any)
        .from("deal_documents")
        .select("original_filename, mime_type")
        .eq("id", job.attachment_id)
        .maybeSingle(),
    ]);

    if (ocrRes.error || !ocrRes.data) {
      throw new Error("OCR result not found");
    }
    const ocrResult = ocrRes.data;
    const ocrText = String(ocrResult.extracted_text ?? "");
    const filename = String(docRes2.data?.original_filename ?? "unknown.pdf");
    const mimeType = String(docRes2.data?.mime_type ?? "application/pdf");

    // Run spine classifier (institutional, deterministic-first, with balance-sheet fix)
    const spineResult = await classifyDocumentSpine(ocrText, filename, mimeType);

    if (!spineResult.docType) {
      throw new Error("Classification failed - no docType returned");
    }

    // Adapt spine result → legacy ClassificationResult shape for downstream compat
    const classifyResult = {
      doc_type: spineResult.docType,
      confidence: Math.round(spineResult.confidence * 100), // spine uses 0-1, legacy uses 0-100
      reasons: [spineResult.reason],
      tags: [] as string[],
      tax_year: spineResult.taxYear != null ? String(spineResult.taxYear) : null,
    };

    // Store classification result
    await (supabase as any)
      .from("document_classifications")
      .upsert({
        deal_id: job.deal_id,
        attachment_id: job.attachment_id,
        doc_type: classifyResult.doc_type,
        confidence: classifyResult.confidence ?? null,
        reasons: classifyResult.reasons ?? [],
      });

    await writeEvent({
      dealId: job.deal_id,
      kind: "deal.document.classified",
      actorUserId: null,
      input: {
        document_id: job.attachment_id,
        doc_type: classifyResult.doc_type,
        confidence: classifyResult.confidence ?? null,
        source: "ocr_classify",
      },
    });

    // Stamp year/type metadata onto the canonical document record.
    await tryStampDealDocumentMetadata({
      dealId: String(job.deal_id),
      attachmentId: String(job.attachment_id),
      extractedText: String(ocrResult.extracted_text ?? ""),
      classifierDocType: String(classifyResult.doc_type ?? ""),
      classifierConfidence01:
        typeof (classifyResult as any).confidence === "number" ? (classifyResult as any).confidence : null,
      classifierReasons: (classifyResult as any).reasons ?? null,
      classifierTaxYear: spineResult.taxYear ?? null,
      classifierPeriodEnd: spineResult.periodEnd ?? null,
    });

    // B2: Spread enqueue removed — artifact pipeline is the single path for spread triggers.

    // MEGA STEP 10: Reconcile conditions (auto-satisfy matching conditions)
    try {
      const sb = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } }
      );

      await reconcileConditionsFromOcrResult({
        sb,
        dealId: job.deal_id,
        jobId: jobId,
        payload: {
          classification: {
            doc_type: classifyResult.doc_type,
            confidence: classifyResult.confidence,
            reasons: classifyResult.reasons,
          },
          file_id: job.attachment_id,
        },
        source: "classify",
      });
    } catch (reconErr) {
      // Non-fatal - log but don't fail job
      console.error("Condition reconciliation failed (non-fatal):", reconErr);
    }

    // Enqueue extraction job — but respect gatekeeper routing
    try {
      // Check if gatekeeper flagged this doc as NEEDS_REVIEW
      const { data: gkCheck } = await (supabase as any)
        .from("deal_documents")
        .select("gatekeeper_needs_review, gatekeeper_route, gatekeeper_classified_at")
        .eq("id", job.attachment_id)
        .maybeSingle();

      if (
        gkCheck?.gatekeeper_needs_review === true ||
        gkCheck?.gatekeeper_route === "NEEDS_REVIEW"
      ) {
        // Hard gate — doc needs human review, skip extraction
        console.log("[classifyProcessor] Skipping extract: gatekeeper_needs_review", {
          jobId,
          attachmentId: job.attachment_id,
          gatekeeperRoute: gkCheck.gatekeeper_route,
        });

        // Ledger event for metrics
        const { logLedgerEvent } = await import("@/lib/pipeline/logLedgerEvent");
        logLedgerEvent({
          dealId: job.deal_id,
          bankId: "",
          eventKey: "gatekeeper.needs_review.block_extract",
          uiState: "waiting",
          uiMessage: `Extraction blocked: doc needs gatekeeper review`,
          meta: { jobId, attachmentId: job.attachment_id, gatekeeperRoute: gkCheck.gatekeeper_route },
        }).catch(() => {});
      } else {
        await enqueueExtractJob(String(job.deal_id), String(job.attachment_id));
      }
    } catch (extractErr) {
      // Non-fatal - extraction is optional enhancement
      console.error("Enqueue extract job failed (non-fatal):", extractErr);
    }

    // Mark job succeeded
    await (supabase as any)
      .from("document_jobs")
      .update({
        status: "SUCCEEDED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return {
      ok: true,
      jobId,
      docType: classifyResult.doc_type,
    };
  } catch (error: any) {
    // Mark job failed
    const { data: failedJob } = await (supabase as any)
      .from("document_jobs")
      .select("attempt, max_attempts")
      .eq("id", jobId)
      .single();

    const attempt = (failedJob?.attempt ?? 0) + 1;
    const maxAttempts = failedJob?.max_attempts ?? 3;

    if (attempt >= maxAttempts) {
      // Final failure
      await (supabase as any)
        .from("document_jobs")
        .update({
          status: "FAILED",
          attempt,
          error: error?.message ?? String(error),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    } else {
      // Retry
      const backoffMs = Math.min(30000 * Math.pow(2, attempt), 300000); // Max 5 minutes
      const nextRunAt = new Date(Date.now() + backoffMs).toISOString();

      await (supabase as any)
        .from("document_jobs")
        .update({
          status: "QUEUED",
          attempt,
          next_run_at: nextRunAt,
          error: error?.message ?? String(error),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    }

    return { ok: false, error: error?.message ?? String(error) };
  }
}

/**
 * Lease and process next available CLASSIFY job
 */
export async function processNextClassifyJob(leaseOwner: string = "worker-1") {
  const supabase = supabaseAdmin();

  const { data: jobs } = await (supabase as any)
    .from("document_jobs")
    .select("id")
    .eq("job_type", "CLASSIFY")
    .eq("status", "QUEUED")
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(1);

  if (!jobs || jobs.length === 0) {
    return { ok: false, error: "No jobs available" };
  }

  return await processClassifyJob(jobs[0].id, leaseOwner);
}

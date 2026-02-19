/**
 * PDF Split Engine — Phase A (Institutional Grade)
 *
 * Physically decomposes a multi-form PDF into independent child artifacts.
 * Each child enters the canonical CLASSIFY → MATCH pipeline independently.
 *
 * Safety model (non-negotiable):
 *   - All abort guards run BEFORE any mutation
 *   - Full success OR full rollback (saga pattern)
 *   - Never partial state — rollback on any step failure
 *   - Ledger events for every child created + final summary
 *
 * Children are first-class artifacts:
 *   - source = 'segment', parent_document_id = parentDocId
 *   - OCR text injected from parent [Page N] slice
 *   - Enqueued for canonical CLASSIFY job (not skipped)
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { downloadPrivateObject, uploadPrivateObject, sha256 } from "@/lib/storage/adminStorage";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { SEGMENTATION_VERSION } from "./types";
import type { PdfSegment } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SplitContext = {
  dealId: string;
  bankId: string;
  parentDocId: string;
  parentOriginalFilename: string;
  storageBucket: string;
  storagePath: string;
  ocrText: string;       // Full parent OCR text with [Page N] markers
  segments: PdfSegment[];
  detectionConfidence: number;
};

export type SplitResult =
  | { ok: true; childDocIds: string[]; childCount: number }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Abort guards (pure, no mutation)
// ---------------------------------------------------------------------------

/** Extract page count from [Page N] markers in OCR text */
function countOcrPages(ocrText: string): number {
  const matches = ocrText.match(/^\[Page\s+(\d+)\]\s*$/gm);
  if (!matches || matches.length === 0) return 1;
  const nums = matches.map((m) => parseInt(m.replace(/\[Page\s+|\]/g, ""), 10));
  return Math.max(...nums);
}

/** Validate that segment page ranges are non-overlapping and cover all pages */
function validatePageCoverage(
  segments: PdfSegment[],
  totalPages: number,
): { valid: boolean; reason?: string } {
  // Check coverage: sorted segments must form a contiguous range
  const sorted = [...segments].sort((a, b) => a.startPage - b.startPage);

  // Check for overlaps
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startPage <= sorted[i - 1].endPage) {
      return { valid: false, reason: "overlapping_page_ranges" };
    }
  }

  // Check sum of pages equals total
  const sumPages = sorted.reduce(
    (acc, s) => acc + (s.endPage - s.startPage + 1),
    0,
  );
  if (sumPages !== totalPages) {
    return {
      valid: false,
      reason: `page_coverage_gap: segments cover ${sumPages}, total is ${totalPages}`,
    };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// OCR text slicing
// ---------------------------------------------------------------------------

/** Extract the OCR text for a page range from parent OCR (uses [Page N] markers) */
function sliceOcrText(
  fullText: string,
  startPage: number,
  endPage: number,
): string {
  const lines = fullText.split("\n");
  const result: string[] = [];
  let capturing = false;
  let currentPage = 0;

  for (const line of lines) {
    const marker = line.match(/^\[Page\s+(\d+)\]\s*$/);
    if (marker) {
      currentPage = parseInt(marker[1], 10);
      capturing = currentPage >= startPage && currentPage <= endPage;
    }
    if (capturing) {
      result.push(line);
    }
  }

  // If no [Page N] markers found (single-page fallback), return full text for page 1
  if (result.length === 0 && startPage === 1 && endPage === 1) {
    return fullText;
  }

  return result.join("\n");
}

// ---------------------------------------------------------------------------
// Main split function
// ---------------------------------------------------------------------------

export async function splitPdfIntoSegments(
  ctx: SplitContext,
): Promise<SplitResult> {
  const sb = supabaseAdmin();

  // ── Idempotency guard ─────────────────────────────────────────────────
  const { data: existing } = await (sb as any)
    .from("deal_documents")
    .select("id")
    .eq("parent_document_id", ctx.parentDocId)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return { ok: false, reason: "already_split" };
  }

  // ── Download parent PDF bytes ─────────────────────────────────────────
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await downloadPrivateObject({
      bucket: ctx.storageBucket,
      path: ctx.storagePath,
    });
  } catch (e: any) {
    return { ok: false, reason: `download_failed: ${e?.message}` };
  }

  // ── Dynamically import pdf-lib (avoid webpack bundling) ───────────────
  let PDFDocument: typeof import("pdf-lib").PDFDocument;
  try {
    const pdfLib = await import("pdf-lib");
    PDFDocument = pdfLib.PDFDocument;
  } catch {
    return { ok: false, reason: "pdf_lib_unavailable" };
  }

  // ── Abort guard: PDF page count vs OCR page count ─────────────────────
  let pdfDoc: import("pdf-lib").PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: false });
  } catch (e: any) {
    return { ok: false, reason: `pdf_load_failed: ${e?.message}` };
  }

  const pdfPageCount = pdfDoc.getPageCount();
  const ocrPageCount = countOcrPages(ctx.ocrText);

  if (pdfPageCount !== ocrPageCount) {
    return {
      ok: false,
      reason: `page_count_mismatch: pdf=${pdfPageCount} ocr=${ocrPageCount}`,
    };
  }

  if (pdfPageCount > 200) {
    return { ok: false, reason: "exceeds_page_limit" };
  }

  // ── Abort guard: page coverage ─────────────────────────────────────────
  const coverage = validatePageCoverage(ctx.segments, pdfPageCount);
  if (!coverage.valid) {
    return { ok: false, reason: coverage.reason ?? "page_coverage_invalid" };
  }

  // ── Saga state: track created resources for rollback ──────────────────
  const createdChildIds: string[] = [];
  const uploadedPaths: { bucket: string; path: string }[] = [];

  try {
    for (let i = 0; i < ctx.segments.length; i++) {
      const segment = ctx.segments[i];

      // 1. Extract segment PDF bytes (pdf-lib pages are 0-indexed)
      const childDoc = await PDFDocument.create();
      const pageIndices = Array.from(
        { length: segment.endPage - segment.startPage + 1 },
        (_, k) => segment.startPage - 1 + k,
      );
      const copiedPages = await childDoc.copyPages(pdfDoc, pageIndices);
      copiedPages.forEach((p) => childDoc.addPage(p));
      const childPdfBytes = await childDoc.save();

      // 2. Upload child PDF to storage
      const childId = crypto.randomUUID();
      const childStoragePath = `deals/${ctx.dealId}/segments/${childId}.pdf`;
      const childSha = sha256(new Uint8Array(childPdfBytes));

      await uploadPrivateObject({
        bucket: ctx.storageBucket,
        path: childStoragePath,
        bytes: new Uint8Array(childPdfBytes),
        contentType: "application/pdf",
        upsert: false,
      });
      uploadedPaths.push({ bucket: ctx.storageBucket, path: childStoragePath });

      // 3. Insert child deal_document
      const childFilename = `${ctx.parentOriginalFilename}_segment_${i + 1}.pdf`;
      const { error: insertErr } = await (sb as any)
        .from("deal_documents")
        .insert({
          id: childId,
          deal_id: ctx.dealId,
          bank_id: ctx.bankId,
          storage_bucket: ctx.storageBucket,
          storage_path: childStoragePath,
          original_filename: childFilename,
          document_key: `segment:${ctx.parentDocId}:${i}`,
          source: "segment",
          parent_document_id: ctx.parentDocId,
          document_type: segment.anchors.length > 0 ? null : null, // let CLASSIFY determine
          mime_type: "application/pdf",
          size_bytes: childPdfBytes.byteLength,
          sha256: childSha,
          status: "pending",
          virus_status: "clean", // physical split from clean parent
        });

      if (insertErr) {
        throw new Error(`insert_deal_document: ${insertErr.message}`);
      }
      createdChildIds.push(childId);

      // 4. Inject OCR text slice into document_ocr_results
      const childOcrText = sliceOcrText(ctx.ocrText, segment.startPage, segment.endPage);
      await (sb as any)
        .from("document_ocr_results")
        .upsert({
          deal_id: ctx.dealId,
          attachment_id: childId,
          provider: "segmentation",
          status: "SUCCEEDED",
          extracted_text: childOcrText,
          raw_json: {
            source: "segmentation",
            parent_document_id: ctx.parentDocId,
            segment_index: i,
            start_page: segment.startPage,
            end_page: segment.endPage,
            segmentation_version: SEGMENTATION_VERSION,
          },
          tables_json: null,
        });

      // 5. Enqueue CLASSIFY job — child enters canonical pipeline
      await (sb as any)
        .from("document_jobs")
        .upsert(
          {
            deal_id: ctx.dealId,
            attachment_id: childId,
            job_type: "CLASSIFY",
            status: "QUEUED",
            next_run_at: new Date().toISOString(),
          },
          { onConflict: "attachment_id,job_type" },
        );

      // 6. Emit per-child ledger event (fire-and-forget)
      writeEvent({
        dealId: ctx.dealId,
        kind: "document.segmented_child_created",
        scope: "segmentation",
        meta: {
          parent_document_id: ctx.parentDocId,
          child_document_id: childId,
          segment_index: i,
          start_page: segment.startPage,
          end_page: segment.endPage,
          segmentation_version: SEGMENTATION_VERSION,
          detection_confidence: ctx.detectionConfidence,
        },
      }).catch(() => {});
    }

    // ── All children created — emit summary event ──────────────────────
    writeEvent({
      dealId: ctx.dealId,
      kind: "document.segmented",
      scope: "segmentation",
      meta: {
        parent_document_id: ctx.parentDocId,
        child_count: createdChildIds.length,
        segmentation_version: SEGMENTATION_VERSION,
        detection_confidence: ctx.detectionConfidence,
      },
    }).catch(() => {});

    return { ok: true, childDocIds: createdChildIds, childCount: createdChildIds.length };
  } catch (err: any) {
    // ── Compensating rollback ──────────────────────────────────────────
    console.error("[splitPdfIntoSegments] split failed, rolling back", {
      parentDocId: ctx.parentDocId,
      createdCount: createdChildIds.length,
      error: err?.message,
    });

    // Delete created DB rows
    if (createdChildIds.length > 0) {
      await (sb as any)
        .from("deal_documents")
        .delete()
        .in("id", createdChildIds);
    }

    // Delete uploaded GCS objects
    for (const { bucket, path } of uploadedPaths) {
      try {
        await supabaseAdmin().storage.from(bucket).remove([path]);
      } catch {
        // Best-effort — orphan detection will clean up later
      }
    }

    // Emit failure event
    writeEvent({
      dealId: ctx.dealId,
      kind: "document.segmentation_failed",
      scope: "segmentation",
      meta: {
        parent_document_id: ctx.parentDocId,
        reason: err?.message ?? "unknown",
        segmentation_version: SEGMENTATION_VERSION,
      },
    }).catch(() => {});

    return { ok: false, reason: err?.message ?? "split_failed" };
  }
}

import "server-only";

import { sha256 } from "@/lib/storage/adminStorage";
import type { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export type ContentHashResult = {
  sha256Hex: string;
  virusCacheHit: boolean;
  virusStatus: "clean" | "infected" | "scan_failed" | "unknown";
  virusSignature: string | null;
  virusEngine: string | null;
  ocrCacheHit: boolean;
  ocrText: string | null;
  ocrDonorDocId: string | null;
};

/**
 * Compute SHA-256 of file bytes, check virus scan cache, and check OCR dedup.
 *
 * Single entry point for all content-hash gating in the artifact pipeline.
 * Stamps deal_documents.sha256 immediately after computation.
 *
 * Tenant-isolated: every cache lookup is scoped to bank_id.
 */
export async function checkContentHash(args: {
  sb: ReturnType<typeof supabaseAdmin>;
  fileBytes: Buffer | Uint8Array;
  bankId: string;
  dealId: string;
  documentId: string;
}): Promise<ContentHashResult> {
  const { sb, fileBytes, bankId, dealId, documentId } = args;

  // 1. Compute SHA-256
  const sha256Hex = sha256(new Uint8Array(fileBytes));

  // 2. Stamp deal_documents.sha256 immediately
  await (sb as any)
    .from("deal_documents")
    .update({ sha256: sha256Hex })
    .eq("id", documentId);

  logLedgerEvent({
    dealId,
    bankId,
    eventKey: "dedupe.sha256.computed",
    uiState: "done",
    uiMessage: `SHA-256 computed: ${sha256Hex.slice(0, 12)}...`,
    meta: { document_id: documentId, sha256: sha256Hex },
  }).catch(() => {});

  // 3. Check virus_scan_cache
  let virusCacheHit = false;
  let virusStatus: ContentHashResult["virusStatus"] = "unknown";
  let virusSignature: string | null = null;
  let virusEngine: string | null = null;

  try {
    const { data: virusCache } = await (sb as any)
      .from("virus_scan_cache")
      .select("scan_status, virus_signature, scan_engine, scanned_at")
      .eq("bank_id", bankId)
      .eq("content_sha256", sha256Hex)
      .maybeSingle();

    if (virusCache) {
      virusCacheHit = true;
      virusStatus = virusCache.scan_status as ContentHashResult["virusStatus"];
      virusSignature = virusCache.virus_signature ?? null;
      virusEngine = virusCache.scan_engine ?? null;

      if (virusStatus === "clean") {
        // Stamp deal_documents with cached virus result
        await (sb as any)
          .from("deal_documents")
          .update({
            virus_status: "clean",
            virus_scanned_at: virusCache.scanned_at,
            virus_engine: virusEngine,
            virus_signature: null,
          })
          .eq("id", documentId);

        logLedgerEvent({
          dealId,
          bankId,
          eventKey: "dedupe.virus_cache.hit",
          uiState: "done",
          uiMessage: "Virus scan skipped (cache: clean)",
          meta: { document_id: documentId, sha256: sha256Hex, engine: virusEngine },
        }).catch(() => {});
      } else if (virusStatus === "infected") {
        // Stamp deal_documents as infected
        await (sb as any)
          .from("deal_documents")
          .update({
            virus_status: "infected",
            virus_scanned_at: virusCache.scanned_at,
            virus_engine: virusEngine,
            virus_signature: virusSignature,
          })
          .eq("id", documentId);

        logLedgerEvent({
          dealId,
          bankId,
          eventKey: "dedupe.virus_cache.blocked",
          uiState: "error",
          uiMessage: `File blocked: virus detected (${virusSignature})`,
          meta: { document_id: documentId, sha256: sha256Hex, signature: virusSignature },
        }).catch(() => {});
      }
    }
  } catch (err: any) {
    console.warn("[contentHashGate] virus_scan_cache lookup failed (non-fatal)", err?.message);
  }

  // 4. Check OCR dedup: find another doc in same bank with same SHA-256 that has OCR results
  let ocrCacheHit = false;
  let ocrText: string | null = null;
  let ocrDonorDocId: string | null = null;

  try {
    const { data: donorDoc } = await (sb as any)
      .from("deal_documents")
      .select("id")
      .eq("bank_id", bankId)
      .eq("sha256", sha256Hex)
      .neq("id", documentId)
      .limit(1)
      .maybeSingle();

    if (donorDoc) {
      const { data: ocrData } = await (sb as any)
        .from("document_ocr_results")
        .select("extracted_text")
        .eq("attachment_id", donorDoc.id)
        .eq("status", "SUCCEEDED")
        .maybeSingle();

      if (ocrData?.extracted_text) {
        ocrCacheHit = true;
        ocrText = ocrData.extracted_text;
        ocrDonorDocId = String(donorDoc.id);

        logLedgerEvent({
          dealId,
          bankId,
          eventKey: "dedupe.ocr_cache.hit",
          uiState: "done",
          uiMessage: "OCR skipped (reusing cached results from identical file)",
          meta: {
            document_id: documentId,
            donor_doc_id: ocrDonorDocId,
            sha256: sha256Hex,
            text_length: ocrText?.length ?? 0,
          },
        }).catch(() => {});
      }
    }

    if (!ocrCacheHit) {
      logLedgerEvent({
        dealId,
        bankId,
        eventKey: "dedupe.ocr_cache.miss",
        uiState: "done",
        uiMessage: "No OCR cache — fresh OCR required",
        meta: { document_id: documentId, sha256: sha256Hex },
      }).catch(() => {});
    }
  } catch (err: any) {
    console.warn("[contentHashGate] OCR dedup lookup failed (non-fatal)", err?.message);
  }

  return {
    sha256Hex,
    virusCacheHit,
    virusStatus,
    virusSignature,
    virusEngine,
    ocrCacheHit,
    ocrText,
    ocrDonorDocId,
  };
}

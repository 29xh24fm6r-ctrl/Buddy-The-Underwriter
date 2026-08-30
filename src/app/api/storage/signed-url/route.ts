import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";
import {
  DOCUMENT_DOWNLOAD_TTL_SECONDS,
  proveCanonicalDocumentDownload,
  type CanonicalDownloadDocument,
} from "@/lib/storage/documentDownloadDelivery";
import { parseDealScopedStorageKey } from "@/lib/storage/legacyRouteAccess";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

/**
 * Legacy compatibility signer.
 *
 * A deal-scoped path is only a locator. It is not authorization to sign any
 * object under that prefix. The path must resolve to a canonical
 * deal_documents row owned by the authenticated bank, and the stored bytes
 * must match that row before a short-lived provider URL is released.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const parsedKey = parseDealScopedStorageKey(searchParams.get("file_key") || "");

  if (!parsedKey) {
    return json(400, { ok: false, error: "invalid_file_key" });
  }

  let access: Awaited<ReturnType<typeof assertDealAccess>>;
  try {
    access = await assertDealAccess(parsedKey.dealId);
  } catch (error) {
    const accessResponse = accessErrorToResponse(error);
    if (accessResponse) return accessResponse;
    return json(500, { ok: false, error: "access_check_failed" });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("deal_documents")
    .select("id, deal_id, bank_id, storage_bucket, storage_path, size_bytes, sha256")
    .eq("deal_id", parsedKey.dealId)
    .eq("bank_id", access.bankId)
    .eq("storage_path", parsedKey.normalizedKey)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[storage/signed-url] canonical document lookup failed", {
      dealId: parsedKey.dealId,
    });
    return json(503, { ok: false, error: "document_state_unavailable" });
  }

  const document = data as CanonicalDownloadDocument | null;
  if (!document) {
    return json(404, { ok: false, error: "document_not_found" });
  }

  let proven;
  try {
    proven = await proveCanonicalDocumentDownload(document);
  } catch (error) {
    console.error("[storage/signed-url] byte proof or signing failed", {
      dealId: parsedKey.dealId,
      documentId: document.id,
      error: error instanceof Error ? error.message : "unknown",
    });
    return json(503, { ok: false, error: "document_integrity_unavailable" });
  }

  await logLedgerEvent({
    dealId: parsedKey.dealId,
    bankId: access.bankId,
    eventKey: "documents.download_signed",
    uiState: "done",
    uiMessage: "Verified legacy document download generated",
    meta: {
      document_id: document.id,
      storage_bucket: proven.bucket,
      storage_path: proven.path,
      size_bytes: proven.sizeBytes,
      sha256: proven.sha256,
      identity_strength: proven.identityStrength,
      expires_in_seconds: DOCUMENT_DOWNLOAD_TTL_SECONDS,
      surface: "legacy_storage_signer",
    },
  });

  return json(200, {
    ok: true,
    url: proven.signedUrl,
    expires_in: DOCUMENT_DOWNLOAD_TTL_SECONDS,
    identity: {
      size_bytes: proven.sizeBytes,
      sha256: proven.sha256,
      strength: proven.identityStrength,
    },
  });
}

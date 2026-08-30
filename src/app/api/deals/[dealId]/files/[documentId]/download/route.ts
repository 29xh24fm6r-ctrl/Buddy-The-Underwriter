import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  DOCUMENT_DOWNLOAD_TTL_SECONDS,
  proveCanonicalDocumentDownload,
  type CanonicalDownloadDocument,
} from "@/lib/storage/documentDownloadDelivery";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ dealId: string; documentId: string }>;
};

export async function GET(_req: NextRequest, ctx: Context) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { dealId, documentId } = await ctx.params;

  try {
    const bankId = await getCurrentBankId();
    const { data, error } = await supabaseAdmin()
      .from("deal_documents")
      .select("id, deal_id, bank_id, storage_bucket, storage_path, size_bytes, sha256")
      .eq("id", documentId)
      .eq("deal_id", dealId)
      .maybeSingle();

    if (error) {
      console.error("[files/download] document state unavailable", {
        dealId,
        documentId,
        userId,
      });
      return NextResponse.json(
        { ok: false, error: "document_state_unavailable" },
        { status: 503 },
      );
    }

    const document = data as CanonicalDownloadDocument | null;
    if (!document || document.bank_id !== bankId) {
      return NextResponse.json(
        { ok: false, error: "document_not_found" },
        { status: 404 },
      );
    }

    let proven;
    try {
      proven = await proveCanonicalDocumentDownload(document);
    } catch (error) {
      console.error("[files/download] byte proof or signing failed", {
        dealId,
        documentId,
        userId,
        error: error instanceof Error ? error.message : "unknown",
      });
      return NextResponse.json(
        { ok: false, error: "document_integrity_unavailable" },
        { status: 503 },
      );
    }

    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "documents.download_signed",
      uiState: "done",
      uiMessage: "Verified document download generated",
      meta: {
        document_id: documentId,
        storage_bucket: proven.bucket,
        storage_path: proven.path,
        size_bytes: proven.sizeBytes,
        sha256: proven.sha256,
        identity_strength: proven.identityStrength,
        expires_in_seconds: DOCUMENT_DOWNLOAD_TTL_SECONDS,
      },
    });

    return NextResponse.redirect(proven.signedUrl, 302);
  } catch (error) {
    console.error("[files/download] unexpected failure", {
      dealId,
      documentId,
      userId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { ok: false, error: "document_download_failed" },
      { status: 500 },
    );
  }
}

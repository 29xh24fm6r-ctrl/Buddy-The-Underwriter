import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
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

function getRequestId(req: NextRequest) {
  return (
    req.headers.get("x-request-id") ||
    req.headers.get("x-buddy-request-id") ||
    crypto.randomUUID()
  );
}

async function withTimeout<T>(label: string, ms: number, fn: () => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new Error(`${label}_timeout`)),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function authorizeDealAccess(dealId: string) {
  const { userId } = await withTimeout("clerk_auth", 4_000, async () => clerkAuth());
  if (!userId) return { ok: false as const, status: 401, error: "unauthorized" };

  const bankId = await withTimeout("bank_context", 6_000, async () => getCurrentBankId());
  const { data: deal, error } = await withTimeout("deal_lookup", 8_000, async () =>
    supabaseAdmin().from("deals").select("id, bank_id").eq("id", dealId).maybeSingle(),
  );

  if (error) {
    console.error("[files/signed-url] deal state unavailable", { dealId });
    return { ok: false as const, status: 503, error: "document_state_unavailable" };
  }
  if (!deal || deal.bank_id !== bankId) {
    return { ok: false as const, status: 404, error: "document_not_found" };
  }

  return { ok: true as const, bankId };
}

async function resolveDocument(args: {
  dealId: string;
  fileId?: string | null;
  storagePath?: string | null;
}): Promise<{ document: CanonicalDownloadDocument | null; error: unknown }> {
  let query = supabaseAdmin()
    .from("deal_documents")
    .select("id, deal_id, bank_id, storage_bucket, storage_path, size_bytes, sha256")
    .eq("deal_id", args.dealId);

  if (args.fileId) query = query.eq("id", args.fileId);
  else if (args.storagePath) query = query.eq("storage_path", args.storagePath);
  else return { document: null, error: null };

  const { data, error } = await query.maybeSingle();
  return {
    document: (data as CanonicalDownloadDocument | null) ?? null,
    error,
  };
}

async function issueDownload(args: {
  req: NextRequest;
  dealId: string;
  fileId?: string | null;
  storagePath?: string | null;
}) {
  const requestId = getRequestId(args.req);
  const authz = await authorizeDealAccess(args.dealId);
  if (!authz.ok) {
    return NextResponse.json(
      { ok: false, error: authz.error, requestId },
      { status: authz.status },
    );
  }

  if (!args.fileId && !args.storagePath) {
    return NextResponse.json(
      { ok: false, error: "missing_document_locator", requestId },
      { status: 400 },
    );
  }

  const { document, error } = await withTimeout("document_lookup", 10_000, () =>
    resolveDocument({
      dealId: args.dealId,
      fileId: args.fileId,
      storagePath: args.storagePath,
    }),
  );

  if (error) {
    console.error("[files/signed-url] document state unavailable", {
      dealId: args.dealId,
      requestId,
    });
    return NextResponse.json(
      { ok: false, error: "document_state_unavailable", requestId },
      { status: 503 },
    );
  }
  if (!document || (document.bank_id && document.bank_id !== authz.bankId)) {
    return NextResponse.json(
      { ok: false, error: "document_not_found", requestId },
      { status: 404 },
    );
  }

  let proven;
  try {
    proven = await withTimeout("document_delivery_proof", 35_000, () =>
      proveCanonicalDocumentDownload(document),
    );
  } catch (error) {
    console.error("[files/signed-url] byte proof or signing failed", {
      dealId: args.dealId,
      documentId: document.id,
      requestId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { ok: false, error: "document_integrity_unavailable", requestId },
      { status: 503 },
    );
  }

  await logLedgerEvent({
    dealId: args.dealId,
    bankId: authz.bankId,
    eventKey: "documents.download_signed",
    uiState: "done",
    uiMessage: "Verified document download generated",
    meta: {
      document_id: document.id,
      storage_bucket: proven.bucket,
      storage_path: proven.path,
      size_bytes: proven.sizeBytes,
      sha256: proven.sha256,
      identity_strength: proven.identityStrength,
      expires_in_seconds: DOCUMENT_DOWNLOAD_TTL_SECONDS,
    },
  });

  return NextResponse.json({
    ok: true,
    signedUrl: proven.signedUrl,
    requestId,
    expiresInSeconds: DOCUMENT_DOWNLOAD_TTL_SECONDS,
    identity: {
      sizeBytes: proven.sizeBytes,
      sha256: proven.sha256,
      strength: proven.identityStrength,
    },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
  const { searchParams } = new URL(req.url);
  return issueDownload({
    req,
    dealId,
    fileId: searchParams.get("fileId") || searchParams.get("file_id"),
    storagePath: searchParams.get("stored_name") || searchParams.get("storage_path"),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  // The storage bucket is canonical row state. Never accept a caller-provided
  // bucket fallback for historic rows.
  return issueDownload({
    req,
    dealId,
    fileId:
      typeof body.file_id === "string"
        ? body.file_id
        : typeof body.fileId === "string"
          ? body.fileId
          : null,
    storagePath:
      typeof body.stored_name === "string"
        ? body.stored_name
        : typeof body.storage_path === "string"
          ? body.storage_path
          : null,
  });
}

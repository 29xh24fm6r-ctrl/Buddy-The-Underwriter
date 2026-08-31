import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import {
  createAuthorizedDocumentDownload,
  withDocumentDownloadTimeout,
} from "@/lib/storage/createAuthorizedDocumentDownload";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

async function getActorBankId(): Promise<
  { ok: true; bankId: string } | { ok: false; status: 401 | 503; error: string }
> {
  try {
    await withDocumentDownloadTimeout(requireUser(), 4_000);
  } catch {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  try {
    return {
      ok: true,
      bankId: await withDocumentDownloadTimeout(getCurrentBankId(), 6_000),
    };
  } catch {
    return { ok: false, status: 503, error: "tenant_context_unavailable" };
  }
}

async function respond(args: {
  dealId: string;
  documentId?: string | null;
  storagePath?: string | null;
}) {
  const actor = await getActorBankId();
  if (!actor.ok) return json({ ok: false, error: actor.error }, actor.status);

  const result = await createAuthorizedDocumentDownload({ ...args, bankId: actor.bankId }).catch(
    () => ({ ok: false as const, status: 503 as const, error: "download_unavailable" as const }),
  );
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);

  // #996 contract: callers receive the proven byte identity alongside the URL,
  // so a client can verify what it is about to fetch.
  return json({
    ok: true,
    signedUrl: result.signedUrl,
    expiresInSeconds: result.expiresInSeconds,
    identity: result.identity,
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const fileId = req.nextUrl.searchParams.get("fileId") || req.nextUrl.searchParams.get("file_id");
  const storagePath =
    req.nextUrl.searchParams.get("stored_name") || req.nextUrl.searchParams.get("storage_path");
  return respond({ dealId, documentId: fileId, storagePath });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > 4_096) {
    return json({ ok: false, error: "invalid_request" }, 413);
  }

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > 4_096) return json({ ok: false, error: "invalid_request" }, 413);
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  // The storage bucket is canonical row state. Never accept a caller-provided
  // bucket fallback for historic rows. file_id remains accepted here: dropping
  // it would have broken every POST caller that addresses a document by id.
  const documentId =
    typeof body.file_id === "string"
      ? body.file_id
      : typeof body.fileId === "string"
        ? body.fileId
        : null;
  const storagePath =
    typeof body.stored_name === "string"
      ? body.stored_name
      : typeof body.storage_path === "string"
        ? body.storage_path
        : null;

  return respond({ dealId, documentId, storagePath });
}

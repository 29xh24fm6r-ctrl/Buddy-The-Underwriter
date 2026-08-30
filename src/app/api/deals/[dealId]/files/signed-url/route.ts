import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { createAuthorizedDocumentDownload } from "@/lib/storage/createAuthorizedDocumentDownload";

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

async function getActorBankId(): Promise<{ ok: true; bankId: string } | { ok: false; status: 401 | 503; error: string }> {
  try {
    await requireUser();
  } catch {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  try {
    return { ok: true, bankId: await getCurrentBankId() };
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
  return json({ ok: true, signedUrl: result.signedUrl });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const fileId = req.nextUrl.searchParams.get("fileId") || req.nextUrl.searchParams.get("file_id");
  const storagePath = req.nextUrl.searchParams.get("stored_name") || req.nextUrl.searchParams.get("storage_path");
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

  const storagePath = String(body.stored_name || body.storage_path || "");
  return respond({ dealId, storagePath });
}

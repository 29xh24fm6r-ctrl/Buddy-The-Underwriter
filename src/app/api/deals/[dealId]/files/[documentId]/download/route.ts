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

function json(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE_HEADERS });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string; documentId: string }> },
) {
  try {
    await requireUser();
  } catch {
    return json("unauthorized", 401);
  }

  let bankId: string;
  try {
    bankId = await getCurrentBankId();
  } catch {
    return json("tenant_context_unavailable", 503);
  }

  const { dealId, documentId } = await params;
  const result = await createAuthorizedDocumentDownload({ dealId, bankId, documentId }).catch(
    () => ({ ok: false as const, status: 503 as const, error: "download_unavailable" as const }),
  );
  if (!result.ok) return json(result.error, result.status);

  return NextResponse.redirect(result.signedUrl, {
    status: 302,
    headers: NO_STORE_HEADERS,
  });
}

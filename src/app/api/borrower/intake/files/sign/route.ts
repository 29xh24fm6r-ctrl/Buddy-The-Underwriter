import { NextRequest, NextResponse } from "next/server";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { signDealUpload } from "@/lib/uploads/signDealUpload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/borrower/intake/files/sign
 *
 * SPEC-BORROWER-STRUCTURED-ASSUMPTIONS-1-HOTFIX — the self-serve /start
 * funnel had NO working document-upload path. IntakeFinancialsStep called
 * directDealDocumentUpload(), which signs via /api/deals/[dealId]/files/sign
 * and records via /api/deals/[dealId]/files/record — both gated on
 * requireUser()/clerkAuth() (staff-only). A borrower authenticated only via
 * the buddy_borrower_session cookie has no Clerk session and always 401'd.
 * The two existing "borrower portal" upload routes
 * (/api/portal/[token]/files/sign and /api/borrower/portal/[token]/files/
 * sign) don't help either — both resolve their token against
 * borrower_portal_links, a third, unrelated auth table with 0 rows for
 * this tenant's self-serve deals.
 *
 * This route authenticates via the same cookie every other /start route
 * already trusts (getBorrowerSession()) and reuses the existing,
 * auth-agnostic signDealUpload() helper — same storage backend, same MIME
 * allowlist, same size limit as every other upload path. No new storage
 * mechanism.
 */
export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();

  const session = await getBorrowerSession();
  if (!session?.deal_id) {
    return NextResponse.json(
      { ok: false, error: "no_borrower_session", request_id: requestId },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const filename = typeof body.filename === "string" ? body.filename : "";
  const mimeType = typeof body.mime_type === "string" ? body.mime_type : null;
  const sizeBytes = typeof body.size_bytes === "number" ? body.size_bytes : 0;
  const checklistKey = typeof body.checklist_key === "string" ? body.checklist_key : null;

  const result = await signDealUpload({
    req,
    dealId: session.deal_id,
    filename,
    mimeType,
    sizeBytes,
    checklistKey,
    requestId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, details: result.details, request_id: result.requestId },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    deal_id: session.deal_id,
    upload: {
      file_id: result.upload.fileId,
      object_path: result.upload.objectKey,
      signed_url: result.upload.uploadUrl,
      headers: result.upload.headers,
      bucket: result.upload.bucket,
      checklist_key: result.upload.checklistKey ?? null,
    },
  });
}

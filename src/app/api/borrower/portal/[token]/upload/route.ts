import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DEPRECATED: This endpoint is replaced by signed URL uploads.
 * 
 * New pattern (borrower portal):
 * 1. POST /api/borrower/portal/[token]/files/sign - Get signed URL + deal_id
 * 2. PUT <signed_url> - Upload directly to storage
 * 3. POST /api/deals/[dealId]/files/record - Record metadata
 * 
 * See: SIGNED_UPLOAD_ARCHITECTURE.md
 */
export async function POST(req: NextRequest) {
  return NextResponse.json(
    {
      ok: false,
      error: "Endpoint deprecated. Use /files/sign + /files/record pattern. See SIGNED_UPLOAD_ARCHITECTURE.md",
      migration: {
        sign: "/api/borrower/portal/[token]/files/sign",
        record: "/api/deals/[dealId]/files/record",
        docs: "/SIGNED_UPLOAD_ARCHITECTURE.md",
      },
    },
    { status: 410 }, // 410 Gone
  );
}

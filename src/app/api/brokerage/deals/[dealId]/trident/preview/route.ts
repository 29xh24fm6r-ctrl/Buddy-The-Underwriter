import "server-only";

/**
 * POST /api/brokerage/deals/[dealId]/trident/preview
 *
 * Borrower-triggered preview bundle generation. The borrower owns the deal
 * via the `buddy_borrower_session` cookie; we hash + look up; the looked-up
 * session's deal_id must equal the URL's [dealId].
 *
 * Failure modes return 404 (never 403) so the route does not leak the
 * existence of other deals — same pattern as /trident/download/[kind].
 *
 * Final-mode generation is NEVER reachable from this route. The mode is
 * hard-coded to "preview". Final release is gated behind borrower lender
 * pick and is invoked from a different surface.
 */

import { NextRequest, NextResponse } from "next/server";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { generateTridentBundle } from "@/lib/brokerage/trident/generateTridentBundle";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;

  const session = await getBorrowerSession();
  if (!session || session.deal_id !== dealId) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const result = await generateTridentBundle({ dealId, mode: "preview" });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, bundleId: result.bundleId },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    bundleId: result.bundleId,
    mode: result.mode,
    paths: result.paths,
  });
}

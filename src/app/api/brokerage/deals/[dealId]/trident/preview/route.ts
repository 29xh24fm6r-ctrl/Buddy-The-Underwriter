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
 *
 * Generation is admitted here and run by the durable workflow. This route
 * previously awaited the inline generator inside its 300s ceiling; a
 * reclaimed function left the bundle holding a 90-minute lease in `running`
 * that refused every retry until the janitor reclaimed it (audit F-17).
 * Callers receive 202 and read completion from /trident/latest-preview.
 */

import { NextRequest, NextResponse } from "next/server";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { startTridentGeneration } from "@/lib/brokerage/trident/startTridentGeneration";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;

  const session = await getBorrowerSession();
  if (!session || session.deal_id !== dealId) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const started = await startTridentGeneration({ dealId, mode: "preview" });
  if (!started.ok) {
    return NextResponse.json(
      { ok: false, error: started.error, bundleId: started.bundleId },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      accepted: true,
      bundleId: started.bundleId,
      mode: "preview",
      alreadyRunning: started.alreadyRunning === true,
    },
    { status: 202 },
  );
}

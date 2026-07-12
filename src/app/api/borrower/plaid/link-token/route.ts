import "server-only";

/**
 * SPEC S2 C-3 — POST /api/borrower/plaid/link-token
 *
 * Generates a Plaid Link token for the current borrower session. Identity
 * comes from the borrower session cookie (buddy_borrower_session), not a
 * client-supplied deal_id — a flat (non-token-URL) borrower route has no
 * other secure way to bind the request to a specific deal.
 */

import { NextResponse } from "next/server";
import { getBorrowerSessionFromRequest } from "@/lib/brokerage/session";
import { createLinkToken } from "@/lib/integrations/plaid/linkToken";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const session = await getBorrowerSessionFromRequest();
    if (!session) {
      return NextResponse.json({ ok: false, error: "no_borrower_session" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const ownershipEntityId = typeof body.ownership_entity_id === "string" ? body.ownership_entity_id : "";
    const redirectUri = typeof body.redirect_uri === "string" ? body.redirect_uri : undefined;

    const result = await createLinkToken({
      dealId: session.deal_id,
      ownershipEntityId,
      userId: session.tokenHash,
      redirectUri,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    console.error("[/api/borrower/plaid/link-token]", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "unexpected_error" }, { status: 500 });
  }
}

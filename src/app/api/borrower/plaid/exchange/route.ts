import "server-only";

/**
 * SPEC S2 C-3 — POST /api/borrower/plaid/exchange
 *
 * body: { public_token, metadata, deal_id?, ownership_entity_id,
 *         consent_version, consent_text_hash }
 *
 * deal_id/bank_id are resolved from the authenticated borrower session, not
 * trusted from the body — if the caller passes a deal_id it must match the
 * session's, otherwise the request is rejected. This keeps the wire
 * contract shape from the spec while not letting a client bind Plaid data
 * to an arbitrary deal_id.
 *
 * Exchanges the public token, persists the connection, then runs the first
 * sync inline (bounded by maxDuration=60) rather than truly fire-and-forget
 * — Vercel/Next serverless functions are not guaranteed to keep running
 * after the response is sent, so a detached "fire and forget" sync could
 * silently never complete.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSessionFromRequest } from "@/lib/brokerage/session";
import { exchangePublicToken } from "@/lib/integrations/plaid/exchangeToken";
import { syncTransactions } from "@/lib/integrations/plaid/sync";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const session = await getBorrowerSessionFromRequest();
    if (!session) {
      return NextResponse.json({ ok: false, error: "no_borrower_session" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const {
      public_token: publicToken,
      metadata,
      deal_id: bodyDealId,
      ownership_entity_id: ownershipEntityId,
      consent_version: consentVersion,
      consent_text_hash: consentTextHash,
    } = body as Record<string, unknown>;

    if (typeof publicToken !== "string" || !publicToken) {
      return NextResponse.json({ ok: false, error: "missing_public_token" }, { status: 400 });
    }
    if (typeof consentVersion !== "string" || typeof consentTextHash !== "string") {
      return NextResponse.json({ ok: false, error: "missing_consent_capture" }, { status: 400 });
    }
    if (typeof bodyDealId === "string" && bodyDealId !== session.deal_id) {
      return NextResponse.json({ ok: false, error: "deal_id_mismatch" }, { status: 403 });
    }

    const supabase = supabaseAdmin();
    const institution = (metadata as { institution?: { institution_id?: string; name?: string } } | undefined)
      ?.institution;

    const result = await exchangePublicToken({
      publicToken,
      dealId: session.deal_id,
      bankId: session.bank_id,
      ownershipEntityId: typeof ownershipEntityId === "string" ? ownershipEntityId : null,
      institutionId: institution?.institution_id ?? null,
      institutionName: institution?.name ?? null,
      consent: {
        consentVersion,
        consentTextHash,
        consentIp: req.headers.get("x-forwarded-for"),
        consentUserAgent: req.headers.get("user-agent"),
      },
      supabase,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }

    const syncResult = await syncTransactions(result.connectionId, supabase);

    return NextResponse.json({ ok: true, connectionId: result.connectionId, sync: syncResult });
  } catch (e: any) {
    console.error("[/api/borrower/plaid/exchange]", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "unexpected_error" }, { status: 500 });
  }
}

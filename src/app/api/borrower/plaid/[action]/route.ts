import "server-only";

/**
 * SPEC S2 C-3 — POST /api/borrower/plaid/[action]
 * action ∈ {"link-token", "exchange"}
 *
 * Consolidates the former separate borrower/plaid/link-token and
 * borrower/plaid/exchange route files into one dynamic-segment route (no
 * UI caller used either by their old paths, confirmed before this
 * restructure) — route/page slot budget discipline (see the Drift Log).
 * Public URL shape unchanged: [action] matches the same literal path
 * segment ("link-token"/"exchange") those directories occupied.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSessionFromRequest } from "@/lib/brokerage/session";
import { createLinkToken } from "@/lib/integrations/plaid/linkToken";
import { exchangePublicToken } from "@/lib/integrations/plaid/exchangeToken";
import { syncTransactions } from "@/lib/integrations/plaid/sync";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ action: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { action } = await ctx.params;

    const session = await getBorrowerSessionFromRequest();
    if (!session) {
      return NextResponse.json({ ok: false, error: "no_borrower_session" }, { status: 401 });
    }

    if (action === "link-token") {
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
    }

    if (action === "exchange") {
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

      // Bounded inline sync (maxDuration=60), not fire-and-forget — Vercel/
      // Next serverless functions are not guaranteed to keep running after
      // the response is sent.
      const syncResult = await syncTransactions(result.connectionId, supabase);

      return NextResponse.json({ ok: true, connectionId: result.connectionId, sync: syncResult });
    }

    return NextResponse.json({ ok: false, error: `unsupported_action: ${action}` }, { status: 400 });
  } catch (e: any) {
    console.error("[/api/borrower/plaid/[action]]", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "unexpected_error" }, { status: 500 });
  }
}

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

import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type OwnershipScopeResult =
  | { ok: true; ownershipEntityId: string | null }
  | { ok: false; status: 400 | 403 | 503; error: string };

/**
 * Client-provided ownership-entity IDs are tenant selectors. Prove that a
 * non-empty ID belongs to the authenticated deal before it reaches Plaid or
 * connection persistence. An omitted ID remains the supported deal-level flow.
 */
async function scopeOwnershipEntity(
  supabase: ReturnType<typeof supabaseAdmin>,
  rawOwnershipEntityId: unknown,
  dealId: string,
): Promise<OwnershipScopeResult> {
  if (rawOwnershipEntityId === undefined || rawOwnershipEntityId === null || rawOwnershipEntityId === "") {
    return { ok: true, ownershipEntityId: null };
  }
  if (
    typeof rawOwnershipEntityId !== "string" ||
    !UUID_PATTERN.test(rawOwnershipEntityId)
  ) {
    return { ok: false, status: 400, error: "invalid_ownership_entity_id" };
  }

  const { data, error } = await supabase
    .from("ownership_entities")
    .select("id, deal_id")
    .eq("id", rawOwnershipEntityId)
    .eq("deal_id", dealId)
    .maybeSingle();

  if (error) {
    console.error("[plaid/connection] ownership scope read failed", {
      code: error.code ?? "unknown",
    });
    return { ok: false, status: 503, error: "ownership_state_unavailable" };
  }
  if (
    !data ||
    data.id !== rawOwnershipEntityId ||
    data.deal_id !== dealId
  ) {
    return { ok: false, status: 403, error: "ownership_entity_mismatch" };
  }

  return { ok: true, ownershipEntityId: rawOwnershipEntityId };
}

// SPEC-M5 CONVERSATIONAL-INTAKE-1 — same convention as
// src/app/api/deals/[dealId]/screening/[check]/route.ts's CONSENT_VERSION/
// consentTextHash: consent is computed server-side from a static template
// file, never trusted from the client.
const CONSENT_VERSION = "v1.0";

async function plaidConsentTextHash(): Promise<string> {
  const filePath = path.join(process.cwd(), "public", "consent-templates", "plaid-consent-v1.md");
  const text = await readFile(filePath, "utf8");
  return crypto.createHash("sha256").update(text).digest("hex");
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { action } = await ctx.params;

    const session = await getBorrowerSessionFromRequest();
    if (!session) {
      return NextResponse.json({ ok: false, error: "no_borrower_session" }, { status: 401 });
    }

    if (action === "link-token") {
      const body = await req.json().catch(() => ({}) as Record<string, unknown>);
      const redirectUri = typeof body.redirect_uri === "string" ? body.redirect_uri : undefined;
      const ownershipScope = await scopeOwnershipEntity(
        supabaseAdmin(),
        body.ownership_entity_id,
        session.deal_id,
      );
      if (!ownershipScope.ok) {
        return NextResponse.json(
          { ok: false, error: ownershipScope.error },
          { status: ownershipScope.status },
        );
      }

      const result = await createLinkToken({
        dealId: session.deal_id,
        ownershipEntityId: ownershipScope.ownershipEntityId ?? "",
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
        ownership_entity_id: rawOwnershipEntityId,
        consent_acknowledged: consentAcknowledged,
      } = body as Record<string, unknown>;

      if (typeof publicToken !== "string" || !publicToken) {
        return NextResponse.json({ ok: false, error: "missing_public_token" }, { status: 400 });
      }
      if (consentAcknowledged !== true) {
        return NextResponse.json({ ok: false, error: "consent_not_acknowledged" }, { status: 400 });
      }
      if (typeof bodyDealId === "string" && bodyDealId !== session.deal_id) {
        return NextResponse.json({ ok: false, error: "deal_id_mismatch" }, { status: 403 });
      }

      const supabase = supabaseAdmin();
      const ownershipScope = await scopeOwnershipEntity(
        supabase,
        rawOwnershipEntityId,
        session.deal_id,
      );
      if (!ownershipScope.ok) {
        return NextResponse.json(
          { ok: false, error: ownershipScope.error },
          { status: ownershipScope.status },
        );
      }

      const institution = (metadata as { institution?: { institution_id?: string; name?: string } } | undefined)
        ?.institution;

      const result = await exchangePublicToken({
        publicToken,
        dealId: session.deal_id,
        bankId: session.bank_id,
        ownershipEntityId: ownershipScope.ownershipEntityId,
        institutionId: institution?.institution_id ?? null,
        institutionName: institution?.name ?? null,
        consent: {
          consentVersion: CONSENT_VERSION,
          consentTextHash: await plaidConsentTextHash(),
          consentIp: req.headers.get("x-forwarded-for"),
          consentUserAgent: req.headers.get("user-agent"),
        },
        supabase,
      });

      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.errorCode }, { status: 502 });
      }

      // Bounded inline sync (maxDuration=60), not fire-and-forget — Vercel/
      // Next serverless functions are not guaranteed to keep running after
      // the response is sent.
      const syncResult = await syncTransactions(result.connectionId, supabase);
      if (!syncResult.ok) {
        console.error("[plaid/connection] initial sync failed", {
          connectionId: result.connectionId,
        });
        return NextResponse.json(
          {
            ok: false,
            error: "initial_sync_failed",
            connectionId: result.connectionId,
            connectionPersisted: true,
          },
          { status: 503 },
        );
      }

      return NextResponse.json({ ok: true, connectionId: result.connectionId, sync: syncResult });
    }

    return NextResponse.json({ ok: false, error: "unsupported_action" }, { status: 400 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Plaid not configured")) {
      return NextResponse.json(
        { ok: false, errorCode: "plaid_not_configured", error: "Bank connection is being set up — check back soon." },
        { status: 503 },
      );
    }
    console.error("[/api/borrower/plaid/[action]] unexpected failure", {
      name: e instanceof Error ? e.name : "unknown",
    });
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

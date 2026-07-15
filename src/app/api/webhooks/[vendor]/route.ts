import "server-only";

/**
 * POST /api/webhooks/[vendor]
 * vendor ∈ {"signwell", "didit", "plaid"}
 *
 * Consolidates the former separate esign/docuseal/webhook,
 * kyc/persona/webhook, and borrower/plaid/webhook route files into one
 * dynamic-segment dispatcher — route/page slot budget discipline (see the
 * Drift Log). SignWell/Didit replaced DocuSeal/Persona (neither of which
 * was ever deployed/provisioned — see
 * docs/build-logs/ARC00_VENDOR_PROVISIONING_CHECKLIST.md, updated
 * alongside this change); Plaid webhooks would need reconfiguring in the
 * Plaid dashboard to this new URL before relying on them.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifySignwellWebhookEvent } from "@/lib/esign/signwell/verifySignwellWebhook";
import { handleSignwellWebhook } from "@/lib/esign/signwell/service";
import { createSignwellDocumentFromTemplate, fetchSignwellDocument, downloadSignwellCompletedPdf } from "@/lib/esign/signwell/client";
import { verifyDiditWebhookSignature } from "@/lib/identity/kyc/verifyDiditWebhook";
import { handleDiditWebhook } from "@/lib/identity/kyc/service";
import { createDiditSession, fetchDiditSession, getDiditSessionDecision } from "@/lib/identity/kyc/didit";
import { verifyPlaidWebhook } from "@/lib/integrations/plaid/verifyWebhook";
import { syncTransactions } from "@/lib/integrations/plaid/sync";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ vendor: string }> };

async function handleSignwell(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const webhookId = process.env.SIGNWELL_WEBHOOK_ID;
  if (!webhookId) {
    console.error("[/api/webhooks/signwell] SIGNWELL_WEBHOOK_ID not configured");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  const valid = verifySignwellWebhookEvent(rawBody, webhookId);
  if (!valid) {
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  let payload: { event: { type: string }; data: { object: Record<string, any> } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await handleSignwellWebhook(payload, {
      sb: supabaseAdmin(),
      signwell: { createSignwellDocumentFromTemplate, fetchSignwellDocument, downloadSignwellCompletedPdf },
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason, detail: (result as any).detail }, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("[/api/webhooks/signwell]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

async function handleDidit(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const secret = process.env.DIDIT_WEBHOOK_SECRET_KEY;
  if (!secret) {
    console.error("[/api/webhooks/didit] DIDIT_WEBHOOK_SECRET_KEY not configured");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const valid = verifyDiditWebhookSignature({
    sessionId: payload.session_id,
    status: payload.status,
    webhookType: payload.webhook_type,
    timestampHeader: req.headers.get("X-Timestamp"),
    signatureHeader: req.headers.get("X-Signature-Simple"),
    secret,
  });
  if (!valid) {
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  try {
    const result = await handleDiditWebhook(payload, {
      sb: supabaseAdmin(),
      didit: { createDiditSession, fetchDiditSession, getDiditSessionDecision },
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason }, { status: 422 });
    }
    return NextResponse.json({ ok: true, verification_id: result.verification_id, status: result.status });
  } catch (e) {
    console.error("[/api/webhooks/didit]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

async function handlePlaid(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const verification = await verifyPlaidWebhook(rawBody, req.headers.get("Plaid-Verification"));
  if (!verification.ok) {
    console.error("[/api/webhooks/plaid] signature verification failed:", verification.reason);
    return NextResponse.json({ ok: false, error: verification.reason }, { status: 401 });
  }

  let payload: { webhook_type?: string; webhook_code?: string; item_id?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const { webhook_type: webhookType, webhook_code: webhookCode, item_id: itemId } = payload;
  if (!itemId) {
    return NextResponse.json({ ok: false, error: "missing_item_id" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const { data: connection } = await supabase
    .from("borrower_bank_connections")
    .select("id, status")
    .eq("plaid_item_id", itemId)
    .maybeSingle();

  if (!connection) {
    // Not an error — Plaid may retry webhooks for items we no longer track.
    return NextResponse.json({ ok: true, ignored: "connection_not_found" });
  }

  if (webhookType === "TRANSACTIONS") {
    if (["INITIAL_UPDATE", "HISTORICAL_UPDATE", "DEFAULT_UPDATE", "SYNC_UPDATES_AVAILABLE"].includes(webhookCode ?? "")) {
      const result = await syncTransactions(connection.id, supabase);
      return NextResponse.json({ ok: true, webhookType, webhookCode, sync: result });
    }
    if (webhookCode === "TRANSACTIONS_REMOVED") {
      // Removal is also handled inline by the cursor-based sync (the
      // `removed` array) — trigger a sync so the next cursor page picks it up.
      const result = await syncTransactions(connection.id, supabase);
      return NextResponse.json({ ok: true, webhookType, webhookCode, sync: result });
    }
  }

  if (webhookType === "ITEM" && webhookCode === "ERROR") {
    await supabase.from("borrower_bank_connections").update({ status: "error" }).eq("id", connection.id);
    return NextResponse.json({ ok: true, webhookType, webhookCode, statusUpdated: "error" });
  }

  if (webhookType === "ITEM" && (webhookCode === "PENDING_EXPIRATION" || webhookCode === "USER_PERMISSION_REVOKED")) {
    await supabase
      .from("borrower_bank_connections")
      .update({ status: webhookCode === "USER_PERMISSION_REVOKED" ? "revoked" : "expired" })
      .eq("id", connection.id);
    return NextResponse.json({ ok: true, webhookType, webhookCode, statusUpdated: true });
  }

  return NextResponse.json({ ok: true, webhookType, webhookCode, handled: false });
}

export async function POST(req: Request, ctx: Ctx) {
  const { vendor } = await ctx.params;
  if (vendor === "signwell") return handleSignwell(req);
  if (vendor === "didit") return handleDidit(req);
  if (vendor === "plaid") return handlePlaid(req);
  return NextResponse.json({ ok: false, error: `unsupported_vendor: ${vendor}` }, { status: 400 });
}

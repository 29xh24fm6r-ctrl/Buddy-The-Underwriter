import "server-only";

/**
 * POST /api/webhooks/[vendor]
 * vendor ∈ {"docuseal", "persona", "plaid"}
 *
 * Consolidates the former separate esign/docuseal/webhook,
 * kyc/persona/webhook, and borrower/plaid/webhook route files into one
 * dynamic-segment dispatcher — route/page slot budget discipline (see the
 * Drift Log). Docuseal/Persona are not deployed/provisioned in any
 * environment yet (see docs/build-logs/ARC00_VENDOR_PROVISIONING_CHECKLIST.md,
 * updated alongside this change); Plaid webhooks would need reconfiguring
 * in the Plaid dashboard to this new URL before relying on them.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyDocusealWebhookSignature } from "@/lib/esign/docuseal/verifyDocusealWebhook";
import { handleDocusealWebhook } from "@/lib/esign/docuseal/service";
import {
  createDocusealSubmission,
  fetchDocusealSubmission,
  downloadDocusealSignedPdf,
  downloadDocusealAuditTrail,
} from "@/lib/esign/docuseal/client";
import { verifyPersonaWebhookSignature } from "@/lib/identity/kyc/verifyPersonaWebhook";
import { handlePersonaWebhook } from "@/lib/identity/kyc/service";
import { createPersonaInquiry, fetchPersonaInquiry, generatePersonaOneTimeLink } from "@/lib/identity/kyc/persona";
import { verifyPlaidWebhook } from "@/lib/integrations/plaid/verifyWebhook";
import { syncTransactions } from "@/lib/integrations/plaid/sync";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ vendor: string }> };

async function handleDocuseal(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const secret = process.env.DOCUSEAL_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[/api/webhooks/docuseal] DOCUSEAL_WEBHOOK_SECRET not configured");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  const valid = verifyDocusealWebhookSignature(rawBody, req.headers.get("X-Docuseal-Signature"), secret);
  if (!valid) {
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  let payload: { event_type: string; data: Record<string, any> };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await handleDocusealWebhook(payload, {
      sb: supabaseAdmin(),
      docuseal: { createDocusealSubmission, fetchDocusealSubmission, downloadDocusealSignedPdf, downloadDocusealAuditTrail },
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason, detail: (result as any).detail }, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("[/api/webhooks/docuseal]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

async function handlePersona(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const secret = process.env.PERSONA_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[/api/webhooks/persona] PERSONA_WEBHOOK_SECRET not configured");
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  const valid = verifyPersonaWebhookSignature(rawBody, req.headers.get("Persona-Signature"), secret);
  if (!valid) {
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await handlePersonaWebhook(payload, {
      sb: supabaseAdmin(),
      persona: { createPersonaInquiry, fetchPersonaInquiry, generatePersonaOneTimeLink },
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason }, { status: 422 });
    }
    return NextResponse.json({ ok: true, verification_id: result.verification_id, status: result.status });
  } catch (e) {
    console.error("[/api/webhooks/persona]", e);
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
  if (vendor === "docuseal") return handleDocuseal(req);
  if (vendor === "persona") return handlePersona(req);
  if (vendor === "plaid") return handlePlaid(req);
  return NextResponse.json({ ok: false, error: `unsupported_vendor: ${vendor}` }, { status: 400 });
}

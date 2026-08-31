import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { sendSmsWithConsent } from "@/lib/sms/send";
import { upsertBorrowerPhoneLink } from "@/lib/sms/phoneLinks";
import { isE164, normalizeE164 } from "@/lib/sms/phone";
import { parsePortalLinkInput, PORTAL_NO_STORE, resolvePortalOrigin } from "@/lib/portal/requestBoundary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PORTAL_NO_STORE });
}

async function revokeLink(id: string) {
  const revokedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin().from("borrower_portal_links")
    .update({ revoked_at: revokedAt }).eq("id", id).is("revoked_at", null)
    .select("id, revoked_at").maybeSingle();
  return !error && data?.id === id && data.revoked_at === revokedAt;
}

async function handle(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const input = parsePortalLinkInput(body);
  if (!input || !body || typeof body !== "object") return json({ ok: false, error: "invalid_request" }, 400);
  const raw = body as Record<string, unknown>;
  let phone: string;
  try {
    phone = normalizeE164(typeof raw.to_phone === "string" ? raw.to_phone : "");
  } catch {
    return json({ ok: false, error: "invalid_phone" }, 400);
  }
  if (!isE164(phone)) return json({ ok: false, error: "invalid_phone" }, 400);
  const note = typeof raw.message === "string" ? raw.message.trim() : "";
  if (note.length > 300) return json({ ok: false, error: "invalid_message" }, 400);
  const origin = resolvePortalOrigin(process.env.NEXT_PUBLIC_APP_URL, process.env.NODE_ENV);
  if (!origin) return json({ ok: false, error: "portal_configuration_unavailable" }, 503);

  const access = await ensureDealBankAccess(input.dealId);
  if (!access.ok) {
    const status = access.error === "unauthorized" ? 401 : access.error === "deal_not_found" ? 404 : 403;
    return json({ ok: false, error: access.error }, status);
  }

  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + input.expiresHours * 3_600_000).toISOString();
  const { data: link, error } = await supabaseAdmin().from("borrower_portal_links").insert({
    deal_id: input.dealId, bank_id: access.bankId, token, label: input.label,
    single_use: input.singleUse, expires_at: expiresAt, channel: "sms",
  }).select("id, token, deal_id, bank_id, expires_at").single();
  if (error || !link || link.token !== token || link.deal_id !== input.dealId || link.bank_id !== access.bankId) {
    console.error("[portal/send-link] persistence_unproven");
    return json({ ok: false, error: "link_creation_unavailable" }, 503);
  }

  const portalUrl = `${origin}/upload/${token}`;
  try {
    await upsertBorrowerPhoneLink({
      phoneE164: phone, bankId: access.bankId, dealId: input.dealId, source: "portal_link",
      metadata: { label: input.label, portal_link_id: link.id, created_via: "send_link_api" },
    });
    const result = await sendSmsWithConsent({
      dealId: input.dealId, to: phone,
      body: `${note ? `${note}\n\n` : ""}Buddy upload link: ${portalUrl}\n(Expires in ${input.expiresHours}h)`,
      label: "Upload link", metadata: { portal_link_id: link.id, expires_at: expiresAt },
    });
    if (typeof result?.sid !== "string" || !result.sid.trim() || result.sid.length > 256) throw new Error("provider_acceptance_unproven");
    if (result.status === "suppressed") {
      const revoked = await revokeLink(link.id);
      return json({ ok: false, error: revoked ? "sms_suppressed" : "delivery_reconciliation_required" }, 503);
    }
    return json({ ok: true, portal_url: portalUrl, sid: result.sid, token });
  } catch (caught: unknown) {
    const dispatched = typeof caught === "object" && caught && "dispatched" in caught && (caught as { dispatched?: unknown }).dispatched === true;
    if (dispatched) {
      console.error("[portal/send-link] provider_accepted_audit_unproven");
      return json({ ok: false, error: "delivery_reconciliation_required" }, 503);
    }
    const revoked = await revokeLink(link.id);
    if (!revoked) {
      console.error("[portal/send-link] failed_delivery_link_revocation_unproven");
      return json({ ok: false, error: "delivery_reconciliation_required" }, 503);
    }
    const code = typeof caught === "object" && caught && "code" in caught ? String((caught as { code?: unknown }).code) : "";
    return json({ ok: false, error: code === "SMS_OPTED_OUT" ? "sms_opted_out" : "sms_delivery_unavailable" }, code === "SMS_OPTED_OUT" ? 403 : 502);
  }
}

export async function POST(req: NextRequest) {
  try { return await handle(req); }
  catch { console.error("[portal/send-link] unexpected_failure"); return json({ ok: false, error: "sms_delivery_unavailable" }, 503); }
}

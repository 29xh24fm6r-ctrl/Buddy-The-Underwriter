import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { parsePortalLinkInput, PORTAL_NO_STORE, resolvePortalOrigin } from "@/lib/portal/requestBoundary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PORTAL_NO_STORE });
}

async function handle(req: NextRequest) {
  const input = parsePortalLinkInput(await req.json().catch(() => null));
  if (!input) return json({ ok: false, error: "invalid_request" }, 400);

  const origin = resolvePortalOrigin(process.env.NEXT_PUBLIC_APP_URL, process.env.NODE_ENV);
  if (!origin) return json({ ok: false, error: "portal_configuration_unavailable" }, 503);

  const access = await ensureDealBankAccess(input.dealId);
  if (!access.ok) {
    const status = access.error === "unauthorized" ? 401 : access.error === "deal_not_found" ? 404 : 403;
    return json({ ok: false, error: access.error }, status);
  }

  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + input.expiresHours * 3_600_000).toISOString();
  const { data, error } = await supabaseAdmin()
    .from("borrower_portal_links")
    .insert({
      deal_id: input.dealId,
      bank_id: access.bankId,
      token,
      label: input.label,
      single_use: input.singleUse,
      expires_at: expiresAt,
      channel: input.channel,
    })
    .select("id, token, deal_id, bank_id, expires_at")
    .single();

  if (error || !data || data.token !== token || data.deal_id !== input.dealId || data.bank_id !== access.bankId) {
    console.error("[portal/create-link] persistence_unproven");
    return json({ ok: false, error: "link_creation_unavailable" }, 503);
  }

  return json({ ok: true, token, deal_id: data.deal_id, expires_at: data.expires_at, portal_url: `${origin}/upload/${token}` });
}

export async function POST(req: NextRequest) {
  try { return await handle(req); }
  catch { console.error("[portal/create-link] unexpected_failure"); return json({ ok: false, error: "link_creation_unavailable" }, 503); }
}

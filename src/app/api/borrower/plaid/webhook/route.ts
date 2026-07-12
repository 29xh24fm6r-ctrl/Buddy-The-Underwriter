import "server-only";

/**
 * SPEC S2 C-3 — POST /api/borrower/plaid/webhook
 *
 * Plaid webhooks are global (not scoped to a borrower session) — the
 * connection is looked up by plaid_item_id from the payload after
 * signature verification.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyPlaidWebhook } from "@/lib/integrations/plaid/verifyWebhook";
import { syncTransactions } from "@/lib/integrations/plaid/sync";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const verification = await verifyPlaidWebhook(rawBody, req.headers.get("Plaid-Verification"));
  if (!verification.ok) {
    console.error("[/api/borrower/plaid/webhook] signature verification failed:", verification.reason);
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

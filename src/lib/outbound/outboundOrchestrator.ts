/**
 * MEGA STEP 12: Outbound Orchestrator
 * 
 * Orchestrates draft upsert + optional auto-send:
 * 1. Build missing docs plan (from MEGA 11 evidence)
 * 2. Upsert draft in deal_message_drafts (one canonical draft per deal+kind)
 * 3. If auto_send=true + not throttled: send via provider (stub for now)
 * 4. Record in deal_outbound_ledger (audit trail)
 * 
 * Flow:
 * - Upload → OCR → Classify → Reconcile → processMissingDocsOutbound
 * - Auto-updates draft as conditions change
 * - Auto-sends if configured (with throttle: default 240 min)
 */

import * as crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { buildMissingDocsPlan, renderMissingDocsEmail } from "./missingDocsPlanner";

type SupabaseAdmin = ReturnType<typeof createClient>;

function nowIso() {
  return new Date().toISOString();
}

function sha(text: string) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Replace this with Resend/SendGrid/etc when ready.
 * For now: safe default is "stub" (no sending) unless you wire a provider.
 */
async function sendEmailStub(args: { to: string; subject: string; body: string }) {
  console.log("[OUTBOUND:STUB]", { to: args.to, subject: args.subject, bodyPreview: args.body.slice(0, 180) });
  return { provider: "stub", provider_message_id: null as string | null };
}

async function getOutboundSettings(sb: SupabaseAdmin, dealId: string) {
  const { data, error } = await sb
    .from("deal_outbound_settings")
    .select("deal_id,auto_send,throttle_minutes")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (error) throw error;

  // Default row (lazy)
  if (!data) {
    const { error: insErr } = await sb.from("deal_outbound_settings").insert({
      deal_id: dealId,
      auto_send: false,
      throttle_minutes: 240,
      updated_at: nowIso(),
    } as any);
    if (insErr) throw insErr;
    return { auto_send: false, throttle_minutes: 240 };
  }

  const row = data as any;
  return { auto_send: Boolean(row.auto_send), throttle_minutes: Number(row.throttle_minutes ?? 240) };
}

async function getBorrowerEmail(sb: SupabaseAdmin, dealId: string): Promise<string | null> {
  // Best-effort:
  // 1) deals.borrower_email if exists
  // 2) else null (you can wire contacts later)
  const { data, error } = await sb.from("deals").select("borrower_email").eq("id", dealId).maybeSingle();
  if (error) throw error;
  const email = (data as any)?.borrower_email;
  return typeof email === "string" && email.includes("@") ? email : null;
}

async function getDealName(sb: SupabaseAdmin, dealId: string): Promise<string> {
  const { data, error } = await sb.from("deals").select("name").eq("id", dealId).maybeSingle();
  if (error) throw error;
  return ((data as any)?.name as string) ?? "your request";
}

async function loadRulesByKey(sb: SupabaseAdmin) {
  const { data, error } = await sb
    .from("condition_match_rules")
    .select("condition_key,doc_type,min_confidence,matcher")
    .eq("enabled", true);

  if (error) throw error;

  const map = new Map<string, any>();
  for (const r of data ?? []) map.set((r as any).condition_key, r as any);
  return map;
}

async function loadConditionsForDeal(sb: SupabaseAdmin, dealId: string) {
  const { data, error } = await sb
    .from("conditions_to_close")
    .select("id,condition_type,title,satisfied,evidence")
    .eq("deal_id", dealId);

  if (error) throw error;
  return (data ?? []) as any[];
}

async function lastSentWithinThrottle(sb: SupabaseAdmin, args: { dealId: string; kind: string; throttleMinutes: number }) {
  const { data, error } = await sb
    .from("deal_outbound_ledger")
    .select("created_at")
    .eq("deal_id", args.dealId)
    .eq("kind", args.kind)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  if (!data || data.length === 0) return false;

  const last = new Date((data[0] as any).created_at).getTime();
  const mins = (Date.now() - last) / 60000;
  return mins < args.throttleMinutes;
}

async function upsertDraft(sb: SupabaseAdmin, args: {
  dealId: string;
  kind: string;
  fingerprint: string;
  subject: string;
  body: string;
}) {
  // One canonical draft per deal+kind that updates as conditions change.
  // Prefer: update existing non-sent draft; else insert.
  const { data: existing, error } = await sb
    .from("deal_message_drafts")
    .select("id,status")
    .eq("deal_id", args.dealId)
    .eq("kind", args.kind)
    .in("status", ["draft", "pending_approval"])
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) throw error;

  if (existing && existing.length > 0) {
    await sb
      .from("deal_message_drafts")
      .update({
        subject: args.subject,
        body: args.body,
        fingerprint: args.fingerprint,
        updated_at: nowIso(),
        status: "pending_approval",
      } as any)
      .eq("id", (existing[0] as any).id);
    return;
  }

  await sb.from("deal_message_drafts").insert({
    deal_id: args.dealId,
    kind: args.kind,
    status: "pending_approval",
    channel: "email",
    subject: args.subject,
    body: args.body,
    fingerprint: args.fingerprint,
  } as any);
}

async function markDraftSent(sb: SupabaseAdmin, dealId: string, kind: string, fingerprint: string) {
  await sb
    .from("deal_message_drafts")
    .update({ status: "sent", updated_at: nowIso() } as any)
    .eq("deal_id", dealId)
    .eq("kind", kind)
    .eq("fingerprint", fingerprint)
    .in("status", ["draft", "pending_approval"]);
}

async function recordLedger(sb: SupabaseAdmin, args: {
  dealId: string;
  kind: string;
  fingerprint: string;
  to: string;
  subject: string;
  provider: string;
  providerMessageId: string | null;
  status: "sent" | "failed";
  error?: string | null;
}) {
  await sb.from("deal_outbound_ledger").insert({
    deal_id: args.dealId,
    kind: args.kind,
    fingerprint: args.fingerprint,
    to_email: args.to,
    subject: args.subject,
    provider: args.provider,
    provider_message_id: args.providerMessageId,
    status: args.status,
    error: args.error ?? null,
  } as any);
}

export async function processMissingDocsOutbound(args: {
  sb: SupabaseAdmin;
  dealId: string;
  trigger: "reconcile" | "manual" | "scheduler";
}) {
  const { sb, dealId } = args;

  const settings = await getOutboundSettings(sb, dealId);

  const borrowerEmail = await getBorrowerEmail(sb, dealId);
  if (!borrowerEmail) {
    // No target → still generate the draft for humans
    // (Auto-send can't proceed.)
  }

  const dealName = await getDealName(sb, dealId);
  const rulesByKey = await loadRulesByKey(sb);
  const conditions = await loadConditionsForDeal(sb, dealId);

  const plan = buildMissingDocsPlan({ rulesByKey, conditions });
  if (plan.open_count === 0) {
    // Nothing missing → do not spam; optionally cancel pending "missing docs" draft
    await sb
      .from("deal_message_drafts")
      .update({ status: "canceled", updated_at: nowIso() } as any)
      .eq("deal_id", dealId)
      .eq("kind", "MISSING_DOCS_REQUEST")
      .in("status", ["draft", "pending_approval"]);
    return { ok: true, action: "nothing_missing" as const };
  }

  const email = renderMissingDocsEmail({ dealName, borrowerName: null, plan });
  const fingerprint = sha(`${dealId}|MISSING_DOCS_REQUEST|${email.subject}|${email.body}`);

  // Always upsert the draft (human-visible + approval-ready)
  await upsertDraft(sb, {
    dealId,
    kind: "MISSING_DOCS_REQUEST",
    fingerprint,
    subject: email.subject,
    body: email.body,
  });

  // Auto-send gate
  if (!settings.auto_send) {
    return { ok: true, action: "draft_updated" as const, auto_send: false };
  }

  if (!borrowerEmail) {
    return { ok: true, action: "draft_updated_no_recipient" as const, auto_send: true };
  }

  const throttled = await lastSentWithinThrottle(sb, {
    dealId,
    kind: "MISSING_DOCS_REQUEST",
    throttleMinutes: settings.throttle_minutes,
  });

  if (throttled) {
    return { ok: true, action: "throttled" as const, auto_send: true };
  }

  // Send (stub/provider)
  try {
    const sent = await sendEmailStub({ to: borrowerEmail, subject: email.subject, body: email.body });

    await recordLedger(sb, {
      dealId,
      kind: "MISSING_DOCS_REQUEST",
      fingerprint,
      to: borrowerEmail,
      subject: email.subject,
      provider: sent.provider,
      providerMessageId: sent.provider_message_id,
      status: "sent",
    });

    await markDraftSent(sb, dealId, "MISSING_DOCS_REQUEST", fingerprint);

    return { ok: true, action: "sent" as const, auto_send: true };
  } catch (e: any) {
    await recordLedger(sb, {
      dealId,
      kind: "MISSING_DOCS_REQUEST",
      fingerprint,
      to: borrowerEmail,
      subject: email.subject,
      provider: "stub",
      providerMessageId: null,
      status: "failed",
      error: String(e?.message ?? e),
    });

    return { ok: false, action: "send_failed" as const, error: String(e?.message ?? e) };
  }
}

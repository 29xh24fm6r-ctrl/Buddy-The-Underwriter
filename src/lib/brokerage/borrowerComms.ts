/**
 * BRK-10O Borrower Communications — lifecycle messaging.
 */
export type MessageChannel = "email" | "sms" | "in_portal";
export type BorrowerMessage = { trigger: string; channel: MessageChannel; subject: string | null; body: string; recipient: string | null };
export type QueueResult = { ok: true; outboxId: string; suppressed: boolean } | { ok: false; error: string };
export type SendAdapter = (msg: { channel: MessageChannel; recipient: string; subject: string | null; body: string }) => Promise<{ ok: boolean; error?: string }>;
export type CommsCycleResult = { queued: number; sent: number; failed: number; suppressed: number };
type Row = Record<string, any>;
type SB = { from: (t: string) => any };
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function now(): string { return new Date().toISOString(); }
const COOL = 4 * 3_600_000;
const SENS = /token_hash|rawToken|raw_token|service_role_key|password|secret/gi;
function strip(t: string): string { return t.replace(SENS, "[REDACTED]"); }
export const TRIGGER_KEYS = ["session_started","intake_incomplete_24h","discovery_needed","uploads_needed","upload_received","disclosure_ack_needed","package_ready_to_seal","package_sealed","lender_claim_received","borrower_pick_needed","lender_selected","condition_opened","condition_evidence_received","clear_to_close","funded"] as const;
export type TriggerKey = typeof TRIGGER_KEYS[number];
const FB: Record<string, { channel: MessageChannel; subject: string | null; body: string }> = {
  session_started:{channel:"in_portal",subject:"Welcome",body:"Welcome! Buddy is ready to help build your SBA loan package."},uploads_needed:{channel:"in_portal",subject:null,body:"Buddy needs documents to verify your application."},disclosure_ack_needed:{channel:"in_portal",subject:null,body:"Please review and acknowledge disclosures. Buddy does not guarantee loan approval."},package_sealed:{channel:"email",subject:"Package sealed",body:"Your SBA package has been sealed and is visible to matched lenders."},lender_claim_received:{channel:"in_portal",subject:null,body:"A qualified SBA lender has expressed interest in your deal."},borrower_pick_needed:{channel:"email",subject:"Choose your lender",body:"Lenders have claimed your deal. Visit your portal to select one."},lender_selected:{channel:"email",subject:"Lender selected",body:"Your full package is being released to your selected lender."},condition_opened:{channel:"in_portal",subject:null,body:"A new closing condition has been added. Check your portal."},funded:{channel:"email",subject:"Loan funded",body:"Congratulations! Your SBA loan has been funded. Thank you for using Buddy."},
};

export async function buildBorrowerMessage(trigger: string, dealId: string, sb: SB, overrides?: { channel?: MessageChannel; recipient?: string }): Promise<BorrowerMessage> {
  const { data: t } = await sb.from("brokerage_borrower_message_templates").select("channel, subject, body_md").eq("trigger_key", trigger).eq("active", true).limit(1).maybeSingle();
  const fb = FB[trigger] ?? { channel: "in_portal", subject: null, body: `Notification: ${trigger}` };
  return { trigger, channel: overrides?.channel ?? (str(t?.channel) as MessageChannel) ?? fb.channel, subject: str(t?.subject) ?? fb.subject, body: strip(str(t?.body_md) ?? fb.body), recipient: overrides?.recipient ?? null };
}

export async function getBorrowerCommsPreferences(dealId: string, sb: SB): Promise<{ emailAllowed: boolean; smsOptedIn: boolean; email: string | null; phone: string | null }> {
  const { data: d } = await sb.from("deals").select("borrower_email").eq("id", dealId).maybeSingle();
  const email = str(d?.borrower_email);
  const { data: s } = await sb.from("borrower_concierge_sessions").select("extracted_facts").eq("deal_id", dealId).limit(1).maybeSingle();
  const phone = str(s?.extracted_facts?.borrower?.phone);
  return { emailAllowed: Boolean(email), smsOptedIn: Boolean(phone && s?.extracted_facts?.borrower?.sms_opt_in), email, phone };
}

export async function queueBorrowerMessage(trigger: string, dealId: string, channel: MessageChannel, sb: SB): Promise<QueueResult> {
  const prefs = await getBorrowerCommsPreferences(dealId, sb);
  if (channel === "sms" && !prefs.smsOptedIn) return { ok: true, outboxId: "", suppressed: true };
  if (channel === "email" && !prefs.emailAllowed) channel = "in_portal";
  const ck = `${trigger}:${dealId}`;
  const { data: recent } = await sb.from("brokerage_borrower_message_outbox").select("id, created_at").eq("cooldown_key", ck).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (recent) { const age = Date.now() - new Date(str(recent.created_at) ?? "").getTime(); if (age < COOL) return { ok: true, outboxId: String(recent.id), suppressed: true }; }
  const msg = await buildBorrowerMessage(trigger, dealId, sb, { channel, recipient: channel === "email" ? prefs.email ?? undefined : undefined });
  const { data: ins, error } = await sb.from("brokerage_borrower_message_outbox").insert({ deal_id: dealId, trigger_key: trigger, channel: msg.channel, recipient: msg.recipient, subject: msg.subject, body: msg.body, status: msg.channel === "in_portal" ? "sent" : "pending", sent_at: msg.channel === "in_portal" ? now() : null, cooldown_key: ck, created_at: now() }).select("id").single();
  if (error || !ins) return { ok: false, error: error?.message ?? "insert_failed" };
  return { ok: true, outboxId: String(ins.id), suppressed: false };
}

export async function sendBorrowerMessage(outboxId: string, adapter: SendAdapter, sb: SB): Promise<{ ok: boolean; error?: string }> {
  const { data: e } = await sb.from("brokerage_borrower_message_outbox").select("channel, recipient, subject, body, status, attempts").eq("id", outboxId).maybeSingle();
  if (!e || str(e.status) !== "pending") return { ok: false, error: "not_pending" };
  const r = await adapter({ channel: str(e.channel) as MessageChannel, recipient: str(e.recipient) ?? "", subject: str(e.subject), body: str(e.body) ?? "" });
  if (r.ok) await sb.from("brokerage_borrower_message_outbox").update({ status: "sent", sent_at: now() }).eq("id", outboxId);
  else await sb.from("brokerage_borrower_message_outbox").update({ status: "failed", error: r.error ?? "send_failed", attempts: (e.attempts ?? 0) + 1, last_attempt_at: now() }).eq("id", outboxId);
  return r;
}

export async function runBorrowerCommsCycle(sb: SB, adapter?: SendAdapter): Promise<CommsCycleResult> {
  const { data } = await sb.from("brokerage_borrower_message_outbox").select("id").eq("status", "pending");
  let sent = 0, failed = 0; const da: SendAdapter = async () => ({ ok: true });
  for (const row of (data ?? []) as Row[]) { const r = await sendBorrowerMessage(String(row.id), adapter ?? da, sb); if (r.ok) sent++; else failed++; }
  return { queued: (data ?? []).length, sent, failed, suppressed: 0 };
}

export function buildPortalNotification(trigger: string, _dealId: string): { trigger: string; message: string; portalHref: string } {
  return { trigger, message: FB[trigger]?.body ?? `Notification: ${trigger}`, portalHref: "/portal" };
}

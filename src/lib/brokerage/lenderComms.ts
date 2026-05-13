/**
 * BRK-10P Lender Communications — lifecycle messaging with redaction.
 */
export type LenderChannel = "email" | "dashboard";
export type LenderMessageContext = { dealId?: string; listingId?: string; claimId?: string; lenderBankId: string; accessId?: string; stage?: "preview"|"claim"|"picked"|"closing"|"funded" };
export type LenderMessage = { trigger: string; channel: LenderChannel; subject: string | null; body: string; recipient: string | null; lenderBankId: string };
export type LenderQueueResult = { ok: true; outboxId: string; suppressed: boolean } | { ok: false; error: string };
export type SendAdapter = (msg: { channel: LenderChannel; recipient: string; subject: string | null; body: string }) => Promise<{ ok: boolean; error?: string }>;
export type LenderCommsCycleResult = { queued: number; sent: number; failed: number };
type Row = Record<string, any>;
type SB = { from: (t: string) => any };
const COOL = 4 * 3_600_000;
const SENS = /token_hash|rawToken|raw_token|service_role_key|password|secret/gi;
const PII = /borrower_name|borrower_email|borrowerName|borrowerEmail|businessLegalName|streetAddress|phoneNumber|ssn|ein/gi;
const STOR = /\/gcs\/|\/trident-bundles\/|\/sealed-packages\/|storage_path|storage_bucket/gi;
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function now(): string { return new Date().toISOString(); }
function strip(t: string): string { return t.replace(SENS, "[REDACTED]"); }
export const LENDER_TRIGGER_KEYS = ["marketplace_preview_open","claim_window_open","claim_confirmed","claim_window_closing_soon","borrower_selected_lender","package_access_granted","lender_package_not_viewed_24h","condition_requested","condition_evidence_submitted","condition_satisfied","clear_to_close","funded_confirmation_needed","funding_verified","lender_referral_fee_recorded"] as const;
const PICKED_ONLY = new Set<string>(["borrower_selected_lender","package_access_granted","lender_package_not_viewed_24h","condition_requested","condition_evidence_submitted","condition_satisfied","clear_to_close","funded_confirmation_needed","funding_verified","lender_referral_fee_recorded"]);
const PREVIEW = new Set<string>(["marketplace_preview_open","claim_window_open","claim_confirmed","claim_window_closing_soon"]);
const FB: Record<string, { channel: LenderChannel; subject: string | null; body: string }> = {
  marketplace_preview_open:{channel:"email",subject:"New SBA deal available",body:"A new SBA deal matching your criteria is available on Buddy Marketplace."},claim_window_open:{channel:"email",subject:"Claim window open",body:"The claim window is now open for a matched deal."},claim_confirmed:{channel:"email",subject:"Claim confirmed",body:"Your claim has been confirmed."},borrower_selected_lender:{channel:"email",subject:"You've been selected",body:"The borrower selected your bank. Full package access is being granted."},package_access_granted:{channel:"email",subject:"Package access granted",body:"You now have full access to the loan package."},condition_requested:{channel:"dashboard",subject:null,body:"A closing condition requires documentation."},clear_to_close:{channel:"email",subject:"Clear to close",body:"All conditions satisfied. Deal is clear to close."},funding_verified:{channel:"email",subject:"Funding verified",body:"Funding verified. Referral fee recorded."},
};

export function assertLenderMessageSafe(msg: { body: string; subject?: string | null }, stage: "preview"|"claim"|"picked"|"closing"|"funded"): { safe: boolean; issues: string[] } {
  const issues: string[] = []; const combined = `${msg.subject ?? ""} ${msg.body}`;
  if (SENS.test(combined)) issues.push("Contains sensitive key"); SENS.lastIndex = 0;
  if (STOR.test(combined)) issues.push("Contains storage path"); STOR.lastIndex = 0;
  if ((stage === "preview" || stage === "claim") && PII.test(combined)) issues.push("Preview/claim message contains borrower PII field"); PII.lastIndex = 0;
  return { safe: issues.length === 0, issues };
}

export async function buildLenderMessage(trigger: string, ctx: LenderMessageContext, sb: SB, overrides?: { channel?: LenderChannel; recipient?: string }): Promise<LenderMessage> {
  const { data: t } = await sb.from("brokerage_lender_message_templates").select("channel, subject, body_md").eq("trigger_key", trigger).eq("status", "active").limit(1).maybeSingle();
  const fb = FB[trigger] ?? { channel: "email", subject: null, body: `Lender notification: ${trigger}` };
  let body = strip(str(t?.body_md) ?? fb.body);
  if (trigger === "package_access_granted" && ctx.accessId) body += `\n\nView package: /lender/marketplace/package/${ctx.accessId}`;
  return { trigger, channel: overrides?.channel ?? (str(t?.channel) as LenderChannel) ?? fb.channel, subject: str(t?.subject) ?? fb.subject, body, recipient: overrides?.recipient ?? null, lenderBankId: ctx.lenderBankId };
}

export async function getLenderCommsRecipients(lenderBankId: string, sb: SB): Promise<string[]> {
  const { data } = await sb.from("lender_marketplace_agreements").select("signed_by_email").eq("lender_bank_id", lenderBankId).eq("status", "active").limit(1).maybeSingle();
  return data?.signed_by_email ? [String(data.signed_by_email)] : [];
}

export async function queueLenderMessage(trigger: string, ctx: LenderMessageContext, channel: LenderChannel, sb: SB): Promise<LenderQueueResult> {
  if (PICKED_ONLY.has(trigger) && (!ctx.stage || !["picked","closing","funded"].includes(ctx.stage))) return { ok: false, error: "trigger_requires_picked_stage" };
  if (PREVIEW.has(trigger) && ctx.listingId) { const { data: l } = await sb.from("marketplace_listings").select("matched_lender_bank_ids").eq("id", ctx.listingId).limit(1).maybeSingle(); if (l) { const m = Array.isArray(l.matched_lender_bank_ids) ? l.matched_lender_bank_ids : []; if (!m.includes(ctx.lenderBankId)) return { ok: false, error: "lender_not_matched" }; } }
  const ck = `${trigger}:${ctx.lenderBankId}:${ctx.listingId ?? ctx.dealId ?? ""}`;
  const { data: recent } = await sb.from("brokerage_lender_message_outbox").select("id, created_at").eq("cooldown_key", ck).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (recent) { const age = Date.now() - new Date(str(recent.created_at) ?? "").getTime(); if (age < COOL) return { ok: true, outboxId: String(recent.id), suppressed: true }; }
  const recipients = await getLenderCommsRecipients(ctx.lenderBankId, sb);
  const msg = await buildLenderMessage(trigger, ctx, sb, { channel, recipient: recipients[0] });
  const stage = ctx.stage ?? (PREVIEW.has(trigger) ? "preview" : "picked");
  const safety = assertLenderMessageSafe(msg, stage as any);
  if (!safety.safe) return { ok: false, error: `message_unsafe: ${safety.issues.join(", ")}` };
  const { data: ins, error } = await sb.from("brokerage_lender_message_outbox").insert({ deal_id: ctx.dealId ?? null, listing_id: ctx.listingId ?? null, claim_id: ctx.claimId ?? null, lender_bank_id: ctx.lenderBankId, trigger_key: trigger, channel: msg.channel, recipient: msg.recipient, subject: msg.subject, body: msg.body, status: msg.channel === "dashboard" ? "sent" : "pending", sent_at: msg.channel === "dashboard" ? now() : null, cooldown_key: ck, created_at: now() }).select("id").single();
  if (error || !ins) return { ok: false, error: error?.message ?? "insert_failed" };
  return { ok: true, outboxId: String(ins.id), suppressed: false };
}

export async function sendLenderMessage(outboxId: string, adapter: SendAdapter, sb: SB): Promise<{ ok: boolean; error?: string }> {
  const { data: e } = await sb.from("brokerage_lender_message_outbox").select("channel, recipient, subject, body, status, attempts").eq("id", outboxId).maybeSingle();
  if (!e || str(e.status) !== "pending") return { ok: false, error: "not_pending" };
  const r = await adapter({ channel: str(e.channel) as LenderChannel, recipient: str(e.recipient) ?? "", subject: str(e.subject), body: str(e.body) ?? "" });
  if (r.ok) await sb.from("brokerage_lender_message_outbox").update({ status: "sent", sent_at: now() }).eq("id", outboxId);
  else await sb.from("brokerage_lender_message_outbox").update({ status: "failed", error: r.error ?? "send_failed", attempts: (e.attempts ?? 0) + 1, last_attempt_at: now() }).eq("id", outboxId);
  return r;
}

export async function runLenderCommsCycle(sb: SB, adapter?: SendAdapter): Promise<LenderCommsCycleResult> {
  const { data } = await sb.from("brokerage_lender_message_outbox").select("id").eq("status", "pending");
  let sent = 0, failed = 0; const da: SendAdapter = async () => ({ ok: true });
  for (const row of (data ?? []) as Row[]) { const r = await sendLenderMessage(String(row.id), adapter ?? da, sb); if (r.ok) sent++; else failed++; }
  return { queued: (data ?? []).length, sent, failed };
}

export function buildLenderPortalLink(ctx: LenderMessageContext): string { return ctx.accessId ? `/lender/marketplace/package/${ctx.accessId}` : "/lender/listings"; }

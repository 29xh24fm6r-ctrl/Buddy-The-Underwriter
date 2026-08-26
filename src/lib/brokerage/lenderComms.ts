/**
 * BRK-10P Lender Communications — lifecycle messaging with redaction.
 */
export type LenderChannel = "email" | "dashboard";
export type LenderMessageContext = { dealId?: string; listingId?: string; claimId?: string; lenderBankId: string; accessId?: string; stage?: "preview"|"claim"|"picked"|"closing"|"funded" };
export type LenderMessage = { trigger: string; channel: LenderChannel; subject: string | null; body: string; recipient: string | null; lenderBankId: string };
export type LenderQueueResult = { ok: true; outboxId: string; suppressed: boolean } | { ok: false; error: string };
export type SendAdapter = (msg: { channel: LenderChannel; recipient: string; subject: string | null; body: string }) => Promise<{ ok: boolean; error?: string }>;
export type LenderCommsCycleResult = { queued: number; sent: number; failed: number; skipped: number };
type Row = Record<string, any>;
type SB = { from: (t: string) => any };
type QueryError = { message?: string } | null | undefined;
const COOL = 4 * 3_600_000;
const SEND_LEASE_MS = 5 * 60_000;
const PAGE_SIZE = 500;
const SENS = /token_hash|rawToken|raw_token|service_role_key|password|secret/gi;
const PII = /borrower_name|borrower_email|borrowerName|borrowerEmail|businessLegalName|streetAddress|phoneNumber|ssn|ein/gi;
const STOR = /\/gcs\/|\/trident-bundles\/|\/sealed-packages\/|storage_path|storage_bucket/gi;
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function now(): string { return new Date().toISOString(); }
function strip(t: string): string { return t.replace(SENS, "[REDACTED]"); }
function dbMessage(error: QueryError): string { return strip(str(error?.message) ?? "database_error"); }
function assertDbOk(error: QueryError, operation: string): void {
  if (error) throw new Error(`[lender-comms] ${operation}: ${dbMessage(error)}`);
}
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
  const { data: t, error } = await sb.from("brokerage_lender_message_templates").select("channel, subject, body_md").eq("trigger_key", trigger).eq("status", "active").limit(1).maybeSingle();
  assertDbOk(error, "template_read");
  const fb = FB[trigger] ?? { channel: "email", subject: null, body: `Lender notification: ${trigger}` };
  let body = strip(str(t?.body_md) ?? fb.body);
  if (trigger === "package_access_granted" && ctx.accessId) body += `\n\nView package: /lender/marketplace/package/${ctx.accessId}`;
  return { trigger, channel: overrides?.channel ?? (str(t?.channel) as LenderChannel) ?? fb.channel, subject: str(t?.subject) ?? fb.subject, body, recipient: overrides?.recipient ?? null, lenderBankId: ctx.lenderBankId };
}

export async function getLenderCommsRecipients(lenderBankId: string, sb: SB): Promise<string[]> {
  const { data, error } = await sb.from("lender_marketplace_agreements").select("signed_by_email").eq("lender_bank_id", lenderBankId).eq("status", "active").limit(1).maybeSingle();
  assertDbOk(error, "recipient_read");
  return data?.signed_by_email ? [String(data.signed_by_email)] : [];
}

export async function queueLenderMessage(trigger: string, ctx: LenderMessageContext, channel: LenderChannel, sb: SB): Promise<LenderQueueResult> {
  if (PICKED_ONLY.has(trigger) && (!ctx.stage || !["picked","closing","funded"].includes(ctx.stage))) return { ok: false, error: "trigger_requires_picked_stage" };
  if (PREVIEW.has(trigger) && ctx.listingId) {
    const { data: listing, error } = await sb.from("marketplace_listings").select("matched_lender_bank_ids").eq("id", ctx.listingId).limit(1).maybeSingle();
    if (error) return { ok: false, error: "listing_read_failed" };
    if (!listing) return { ok: false, error: "listing_not_found" };
    const matched = Array.isArray(listing.matched_lender_bank_ids) ? listing.matched_lender_bank_ids : [];
    if (!matched.includes(ctx.lenderBankId)) return { ok: false, error: "lender_not_matched" };
  }
  const cooldownKey = `${trigger}:${ctx.lenderBankId}:${ctx.listingId ?? ctx.dealId ?? ""}`;
  const { data: recent, error: cooldownError } = await sb.from("brokerage_lender_message_outbox").select("id, created_at").eq("cooldown_key", cooldownKey).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (cooldownError) return { ok: false, error: "cooldown_read_failed" };
  if (recent) { const age = Date.now() - new Date(str(recent.created_at) ?? "").getTime(); if (age < COOL) return { ok: true, outboxId: String(recent.id), suppressed: true }; }
  let recipients: string[];
  let msg: LenderMessage;
  try {
    recipients = await getLenderCommsRecipients(ctx.lenderBankId, sb);
    msg = await buildLenderMessage(trigger, ctx, sb, { channel, recipient: recipients[0] });
  } catch {
    return { ok: false, error: "message_dependency_read_failed" };
  }
  if (channel === "email" && !msg.recipient) return { ok: false, error: "lender_recipient_missing" };
  const stage = ctx.stage ?? (PREVIEW.has(trigger) ? "preview" : "picked");
  const safety = assertLenderMessageSafe(msg, stage as any);
  if (!safety.safe) return { ok: false, error: `message_unsafe: ${safety.issues.join(", ")}` };
  const { data: inserted, error } = await sb.from("brokerage_lender_message_outbox").insert({ deal_id: ctx.dealId ?? null, listing_id: ctx.listingId ?? null, claim_id: ctx.claimId ?? null, lender_bank_id: ctx.lenderBankId, trigger_key: trigger, channel: msg.channel, recipient: msg.recipient, subject: msg.subject, body: msg.body, status: msg.channel === "dashboard" ? "sent" : "pending", sent_at: msg.channel === "dashboard" ? now() : null, cooldown_key: cooldownKey, created_at: now() }).select("id").single();
  if (error || !inserted) return { ok: false, error: "outbox_insert_failed" };
  return { ok: true, outboxId: String(inserted.id), suppressed: false };
}

async function claimLenderMessage(outboxId: string, sb: SB): Promise<Row | null> {
  const { data: current, error: readError } = await sb.from("brokerage_lender_message_outbox").select("id, channel, recipient, subject, body, status, attempts, last_attempt_at").eq("id", outboxId).maybeSingle();
  assertDbOk(readError, "claim_read");
  if (!current || str(current.status) !== "pending") return null;
  const observedLease = str(current.last_attempt_at);
  if (observedLease && Date.now() - new Date(observedLease).getTime() < SEND_LEASE_MS) return null;
  const observedAttempts = Number(current.attempts ?? 0);
  let claim = sb.from("brokerage_lender_message_outbox").update({ attempts: observedAttempts + 1, last_attempt_at: now(), error: null }).eq("id", outboxId).eq("status", "pending").eq("attempts", observedAttempts);
  claim = observedLease ? claim.eq("last_attempt_at", observedLease) : claim.is("last_attempt_at", null);
  const { data: claimed, error: claimError } = await claim.select("id, channel, recipient, subject, body, status, attempts, last_attempt_at").maybeSingle();
  assertDbOk(claimError, "claim_write");
  return claimed ?? null;
}

async function transitionClaimedMessage(outboxId: string, attempts: number, patch: Row, sb: SB, operation: string): Promise<void> {
  const { data, error } = await sb.from("brokerage_lender_message_outbox").update(patch).eq("id", outboxId).eq("status", "pending").eq("attempts", attempts).select("id").maybeSingle();
  assertDbOk(error, operation);
  if (!data) throw new Error(`[lender-comms] ${operation}: claim_lost`);
}

export async function sendLenderMessage(outboxId: string, adapter: SendAdapter, sb: SB): Promise<{ ok: boolean; error?: string }> {
  const claimed = await claimLenderMessage(outboxId, sb);
  if (!claimed) return { ok: false, error: "not_claimed" };
  const attempts = Number(claimed.attempts ?? 1);
  let result: { ok: boolean; error?: string };
  try {
    result = await adapter({ channel: str(claimed.channel) as LenderChannel, recipient: str(claimed.recipient) ?? "", subject: str(claimed.subject), body: str(claimed.body) ?? "" });
  } catch {
    result = { ok: false, error: "provider_exception" };
  }
  if (result.ok) {
    await transitionClaimedMessage(outboxId, attempts, { status: "sent", sent_at: now(), error: null }, sb, "mark_sent");
  } else {
    const failure = strip(str(result.error) ?? "send_failed");
    await transitionClaimedMessage(outboxId, attempts, { status: "failed", error: failure }, sb, "mark_failed");
    result = { ok: false, error: failure };
  }
  return result;
}

async function listPendingLenderMessageIds(sb: SB): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await sb.from("brokerage_lender_message_outbox").select("id").eq("status", "pending").order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
    assertDbOk(error, "cycle_read");
    const page = (data ?? []) as Row[];
    ids.push(...page.map(row => String(row.id)));
    if (page.length < PAGE_SIZE) break;
  }
  return ids;
}

export async function runLenderCommsCycle(sb: SB, adapter?: SendAdapter): Promise<LenderCommsCycleResult> {
  const ids = await listPendingLenderMessageIds(sb);
  let sent = 0, failed = 0, skipped = 0;
  const defaultAdapter: SendAdapter = async () => ({ ok: true });
  for (const id of ids) {
    const result = await sendLenderMessage(id, adapter ?? defaultAdapter, sb);
    if (result.ok) sent++;
    else if (result.error === "not_claimed") skipped++;
    else failed++;
  }
  return { queued: ids.length, sent, failed, skipped };
}

export function buildLenderPortalLink(ctx: LenderMessageContext): string { return ctx.accessId ? `/lender/marketplace/package/${ctx.accessId}` : "/lender/listings"; }

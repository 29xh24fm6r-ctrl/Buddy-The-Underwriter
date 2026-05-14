/**
 * Phase 11E — Borrower Nudge Engine
 *
 * Uses readiness/document gaps to enqueue safe borrower nudges
 * through the comms outbox. No direct sending.
 */

import { enqueueCommsMessage } from "@/lib/brokerage/commsOutbox";
import { isValidE164 } from "@/lib/brokerage/commsAdapters";

// ── Types ───────────────────────────────────────────────────────────────────

export type NudgeEligibility = {
  eligible: boolean;
  emailAllowed: boolean;
  smsAllowed: boolean;
  skipReason: string | null;
  missingDocs: string[];
  borrowerFirstName: string | null;
  borrowerEmail: string | null;
  borrowerPhone: string | null;
  dealStatus: string | null;
};

export type NudgePlan = {
  dealId: string;
  purpose: string;
  channels: Array<"email" | "sms">;
  missingDocs: string[];
  emailBody: string | null;
  smsBody: string | null;
  emailSubject: string | null;
  skipped: boolean;
  skipReason: string | null;
};

export type NudgeEnqueueResult = {
  enqueued: number;
  skipped: number;
  skipReason: string | null;
  outboxIds: string[];
};

type Row = Record<string, any>;
type SB = { from: (t: string) => any };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const CLOSED_STATUSES = new Set(["closed", "declined", "funded", "archived", "docs_complete"]);
const NUDGE_COOLDOWN_MS = 24 * 3_600_000;

// ── Eligibility ─────────────────────────────────────────────────────────────

export async function getBorrowerNudgeEligibility(
  dealId: string,
  sb: SB,
): Promise<NudgeEligibility> {
  // Load deal
  const { data: deal } = await sb
    .from("deals")
    .select("status, borrower_name, borrower_email")
    .eq("id", dealId)
    .maybeSingle();

  const dealStatus = str(deal?.status);

  if (!deal) {
    return { eligible: false, emailAllowed: false, smsAllowed: false, skipReason: "deal_not_found", missingDocs: [], borrowerFirstName: null, borrowerEmail: null, borrowerPhone: null, dealStatus: null };
  }

  if (dealStatus && CLOSED_STATUSES.has(dealStatus)) {
    return { eligible: false, emailAllowed: false, smsAllowed: false, skipReason: `deal_status_${dealStatus}`, missingDocs: [], borrowerFirstName: str(deal.borrower_name), borrowerEmail: str(deal.borrower_email), borrowerPhone: null, dealStatus };
  }

  // Load concierge for phone/opt-in
  const { data: session } = await sb
    .from("borrower_concierge_sessions")
    .select("extracted_facts")
    .eq("deal_id", dealId)
    .limit(1)
    .maybeSingle();

  const facts = session?.extracted_facts as Record<string, any> | null;
  const phone = str(facts?.borrower?.phone);
  const smsOptIn = Boolean(facts?.borrower?.sms_opt_in);
  const firstName = str(facts?.borrower?.first_name) ?? str(deal.borrower_name)?.split(" ")[0] ?? null;
  const email = str(deal.borrower_email);

  // Load missing docs (unfinalised)
  const { data: docs } = await sb
    .from("deal_documents")
    .select("canonical_type, finalized_at")
    .eq("deal_id", dealId);

  const pending = ((docs ?? []) as Row[]).filter(d => !d.finalized_at);

  // Load required slots
  const { data: slots } = await sb
    .from("deal_document_slots")
    .select("required_doc_type")
    .eq("deal_id", dealId);

  const slotTypes = ((slots ?? []) as Row[]).map(s => str(s.required_doc_type)).filter(Boolean) as string[];
  const docTypes = new Set(((docs ?? []) as Row[]).filter(d => d.finalized_at).map(d => str(d.canonical_type)).filter(Boolean));
  const missingDocs = slotTypes.filter(t => !docTypes.has(t));

  // Also count pending uploads as "missing" signal
  if (missingDocs.length === 0 && pending.length === 0) {
    return { eligible: false, emailAllowed: Boolean(email), smsAllowed: smsOptIn && Boolean(phone) && isValidE164(phone!), skipReason: "no_missing_docs", missingDocs: [], borrowerFirstName: firstName, borrowerEmail: email, borrowerPhone: phone, dealStatus };
  }

  const allMissing = missingDocs.length > 0 ? missingDocs : pending.map(d => str(d.canonical_type) ?? "document");

  return {
    eligible: true,
    emailAllowed: Boolean(email),
    smsAllowed: smsOptIn && Boolean(phone) && isValidE164(phone!),
    skipReason: null,
    missingDocs: allMissing,
    borrowerFirstName: firstName,
    borrowerEmail: email,
    borrowerPhone: phone,
    dealStatus,
  };
}

// ── Build plan ──────────────────────────────────────────────────────────────

export async function buildBorrowerNudgePlan(
  dealId: string,
  sb: SB,
): Promise<NudgePlan> {
  const elig = await getBorrowerNudgeEligibility(dealId, sb);

  await sb.from("brokerage_comms_ledger").insert({
    event_type: "borrower_nudge_plan_built",
    channel: "email",
    deal_id: dealId,
    recipient_masked: elig.borrowerEmail ? elig.borrowerEmail.replace(/^(.).*(@.*)$/, "$1***$2") : "unknown",
    metadata: { eligible: elig.eligible, missingDocs: elig.missingDocs, skipReason: elig.skipReason },
    created_at: new Date().toISOString(),
  });

  if (!elig.eligible) {
    return { dealId, purpose: "missing_documents", channels: [], missingDocs: [], emailBody: null, smsBody: null, emailSubject: null, skipped: true, skipReason: elig.skipReason };
  }

  const channels: Array<"email" | "sms"> = [];
  let emailBody: string | null = null;
  let smsBody: string | null = null;
  const emailSubject = "Documents needed for your SBA loan package";
  const name = elig.borrowerFirstName ?? "there";
  const docList = elig.missingDocs.map(d => `- ${d.replace(/_/g, " ")}`).join("\n");

  if (elig.emailAllowed) {
    channels.push("email");
    emailBody = `Hi ${name},\n\nBuddy needs a few documents to continue building your SBA loan package.\n\nMissing documents:\n${docList}\n\nPlease upload them through your secure portal:\n{{UPLOAD_LINK}}\n\nThank you,\nBuddy Brokerage Team`;
  }

  if (elig.smsAllowed) {
    channels.push("sms");
    smsBody = `Hi ${name}, Buddy needs a few documents to continue your SBA loan package. Please check your secure upload link.`;
  }

  return { dealId, purpose: "missing_documents", channels, missingDocs: elig.missingDocs, emailBody, smsBody, emailSubject, skipped: false, skipReason: null };
}

// ── Enqueue ─────────────────────────────────────────────────────────────────

export async function enqueueBorrowerNudges(
  dealId: string,
  sb: SB,
): Promise<NudgeEnqueueResult> {
  const plan = await buildBorrowerNudgePlan(dealId, sb);

  if (plan.skipped) {
    await sb.from("brokerage_comms_ledger").insert({
      event_type: "borrower_nudge_skipped",
      channel: "email",
      deal_id: dealId,
      recipient_masked: "n/a",
      metadata: { reason: plan.skipReason },
      created_at: new Date().toISOString(),
    });
    return { enqueued: 0, skipped: 1, skipReason: plan.skipReason, outboxIds: [] };
  }

  const today = new Date().toISOString().slice(0, 10);
  const outboxIds: string[] = [];
  let enqueued = 0;
  let skipped = 0;

  for (const channel of plan.channels) {
    const idempotencyKey = `borrower_nudge:${dealId}:${channel}:missing_documents:${today}`;
    const body = channel === "sms" ? (plan.smsBody ?? "") : (plan.emailBody ?? "");
    const elig = await getBorrowerNudgeEligibility(dealId, sb);
    const recipient = channel === "email" ? (elig.borrowerEmail ?? "") : (elig.borrowerPhone ?? "");

    if (!recipient) { skipped++; continue; }

    const result = await enqueueCommsMessage({
      idempotencyKey,
      channel,
      provider: channel === "email" ? "resend" : "telnyx",
      recipient,
      subject: channel === "email" ? plan.emailSubject ?? undefined : undefined,
      body,
      dealId,
      triggerKey: "missing_documents",
    }, sb);

    if (result.created) {
      enqueued++;
      outboxIds.push(result.id);
      await sb.from("brokerage_comms_ledger").insert({
        event_type: "borrower_nudge_enqueued",
        channel,
        deal_id: dealId,
        recipient_masked: channel === "email" ? recipient.replace(/^(.).*(@.*)$/, "$1***$2") : "*".repeat(Math.max(0, recipient.length - 4)) + recipient.slice(-4),
        metadata: { idempotencyKey, missingDocs: plan.missingDocs },
        created_at: new Date().toISOString(),
      });
    } else {
      skipped++; // idempotency dedup
    }
  }

  return { enqueued, skipped, skipReason: null, outboxIds };
}

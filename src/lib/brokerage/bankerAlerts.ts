/**
 * Phase 11F — Banker Deal Alerts
 *
 * Notify banker/broker when borrower/document/comms events
 * need human attention. Routes through comms outbox.
 */

import { enqueueCommsMessage } from "@/lib/brokerage/commsOutbox";

// ── Types ───────────────────────────────────────────────────────────────────

export type BankerAlertPurpose =
  | "borrower_nudge_enqueued"
  | "borrower_nudge_failed"
  | "borrower_nudge_exhausted"
  | "documents_received"
  | "readiness_regressed"
  | "deal_ready_for_review";

export type BankerAlertEligibility = {
  eligible: boolean;
  emailAllowed: boolean;
  slackAllowed: boolean;
  skipReason: string | null;
  bankerEmail: string | null;
  dealName: string | null;
  borrowerName: string | null;
  dealStatus: string | null;
};

export type BankerAlertPlan = {
  dealId: string;
  purpose: BankerAlertPurpose;
  channels: Array<"email" | "slack">;
  emailSubject: string | null;
  emailBody: string | null;
  slackBody: string | null;
  skipped: boolean;
  skipReason: string | null;
};

export type BankerAlertEnqueueResult = {
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

const CLOSED_STATUSES = new Set(["closed", "declined", "funded", "archived"]);

const PURPOSE_LABELS: Record<BankerAlertPurpose, string> = {
  borrower_nudge_enqueued: "Borrower nudge sent",
  borrower_nudge_failed: "Borrower nudge failed",
  borrower_nudge_exhausted: "Borrower nudge exhausted",
  documents_received: "Documents received",
  readiness_regressed: "Readiness regressed",
  deal_ready_for_review: "Deal ready for review",
};

const PURPOSE_ACTIONS: Record<BankerAlertPurpose, string> = {
  borrower_nudge_enqueued: "Monitor borrower response within 24h",
  borrower_nudge_failed: "Contact borrower directly or check outbox errors",
  borrower_nudge_exhausted: "Reach out to borrower manually — automated nudges exhausted",
  documents_received: "Review uploaded documents for completeness",
  readiness_regressed: "Investigate deal blockers and take corrective action",
  deal_ready_for_review: "Review deal and advance to next stage",
};

// ── Recipient ───────────────────────────────────────────────────────────────

/**
 * Who on our side hears about this deal.
 *
 * Precedence, most specific first:
 *  1. The teammate the deal is assigned to. They own it, so the alert is
 *     theirs.
 *  2. Anyone on the deal's bank, oldest membership first — an unassigned deal
 *     still has to reach a human.
 *  3. BROKERAGE_BANKER_EMAIL, a single global override for environments with
 *     no memberships wired up yet.
 *
 * The env var used to be the ONLY source, which is why every alert in
 * production skipped with no_banker_contact: the variable is unset, so no
 * banker alert could fire for any deal on any bank. A single global address
 * is also wrong for a multi-tenant system — one bank's alerts would land in
 * another's inbox — so it now ranks last rather than first.
 *
 * Emails come from app_users, which is where a Clerk user's address is
 * mirrored; a membership with no mirrored address is skipped rather than
 * treated as a recipient.
 */
async function resolveBankerEmail(deal: Row, sb: SB): Promise<string | null> {
  const bankId = str(deal.bank_id);
  const owner = str(deal.brokerage_stage_owner_clerk_user_id);

  if (owner) {
    const email = await emailForClerkUser(owner, sb);
    if (email) return email;
  }

  if (bankId) {
    const { data: members } = await sb
      .from("bank_memberships")
      .select("clerk_user_id, created_at")
      .eq("bank_id", bankId)
      .order("created_at", { ascending: true });
    for (const member of (members ?? []) as Row[]) {
      const id = str(member.clerk_user_id);
      if (!id) continue;
      const email = await emailForClerkUser(id, sb);
      if (email) return email;
    }
  }

  return str(process.env.BROKERAGE_BANKER_EMAIL);
}

async function emailForClerkUser(clerkUserId: string, sb: SB): Promise<string | null> {
  const { data } = await sb
    .from("app_users")
    .select("email")
    .eq("clerk_user_id", clerkUserId)
    .limit(1)
    .maybeSingle();
  return str(data?.email);
}

// ── Eligibility ─────────────────────────────────────────────────────────────

export async function getBankerAlertEligibility(
  dealId: string,
  sb: SB,
): Promise<BankerAlertEligibility> {
  const { data: deal } = await sb
    .from("deals")
    .select("status, display_name, borrower_name, bank_id, brokerage_stage_owner_clerk_user_id")
    .eq("id", dealId)
    .maybeSingle();

  if (!deal) {
    return { eligible: false, emailAllowed: false, slackAllowed: false, skipReason: "deal_not_found", bankerEmail: null, dealName: null, borrowerName: null, dealStatus: null };
  }

  const dealStatus = str(deal.status);
  if (dealStatus && CLOSED_STATUSES.has(dealStatus)) {
    return { eligible: false, emailAllowed: false, slackAllowed: false, skipReason: `deal_status_${dealStatus}`, bankerEmail: null, dealName: str(deal.display_name), borrowerName: str(deal.borrower_name), dealStatus };
  }

  const bankerEmail = await resolveBankerEmail(deal, sb);
  const slackAllowed = Boolean(process.env.BROKERAGE_SLACK_WEBHOOK_URL);

  return {
    eligible: bankerEmail !== null || slackAllowed,
    emailAllowed: bankerEmail !== null,
    slackAllowed,
    skipReason: !bankerEmail && !slackAllowed ? "no_banker_contact" : null,
    bankerEmail,
    dealName: str(deal.display_name) ?? str(deal.borrower_name) ?? dealId,
    borrowerName: str(deal.borrower_name),
    dealStatus,
  };
}

// ── Build plan ──────────────────────────────────────────────────────────────

export async function buildBankerAlertPlan(
  dealId: string,
  purpose: BankerAlertPurpose,
  sb: SB,
  opts?: { reason?: string },
): Promise<BankerAlertPlan> {
  const elig = await getBankerAlertEligibility(dealId, sb);

  await sb.from("brokerage_comms_ledger").insert({
    event_type: "banker_alert_plan_built",
    channel: "email",
    deal_id: dealId,
    recipient_masked: elig.bankerEmail ? elig.bankerEmail.replace(/^(.).*(@.*)$/, "$1***$2") : "n/a",
    metadata: { purpose, eligible: elig.eligible, skipReason: elig.skipReason },
    created_at: new Date().toISOString(),
  });

  if (!elig.eligible) {
    return { dealId, purpose, channels: [], emailSubject: null, emailBody: null, slackBody: null, skipped: true, skipReason: elig.skipReason };
  }

  const channels: Array<"email" | "slack"> = [];
  const label = PURPOSE_LABELS[purpose];
  const action = PURPOSE_ACTIONS[purpose];
  const dealName = elig.dealName ?? dealId;
  const reason = opts?.reason ?? label;

  let emailSubject: string | null = null;
  let emailBody: string | null = null;
  let slackBody: string | null = null;

  if (elig.emailAllowed) {
    channels.push("email");
    emailSubject = `[Buddy] ${dealName} — ${label}`;
    emailBody = `Deal: ${dealName}\nBorrower: ${elig.borrowerName ?? "Unknown"}\n\nAlert: ${label}\nReason: ${reason}\n\nRecommended action: ${action}\n\nView deal: {{DEAL_LINK}}\n\n— Buddy Brokerage Ops`;
  }

  if (elig.slackAllowed) {
    channels.push("slack");
    slackBody = `Buddy alert: ${dealName} — ${label}. Next: ${action} {{DEAL_LINK}}`;
  }

  return { dealId, purpose, channels, emailSubject, emailBody, slackBody, skipped: false, skipReason: null };
}

// ── Enqueue ─────────────────────────────────────────────────────────────────

export async function enqueueBankerAlerts(
  dealId: string,
  purpose: BankerAlertPurpose,
  sb: SB,
  opts?: { reason?: string },
): Promise<BankerAlertEnqueueResult> {
  const plan = await buildBankerAlertPlan(dealId, purpose, sb, opts);

  if (plan.skipped) {
    await sb.from("brokerage_comms_ledger").insert({
      event_type: "banker_alert_skipped",
      channel: "email",
      deal_id: dealId,
      recipient_masked: "n/a",
      metadata: { purpose, reason: plan.skipReason },
      created_at: new Date().toISOString(),
    });
    return { enqueued: 0, skipped: 1, skipReason: plan.skipReason, outboxIds: [] };
  }

  const today = new Date().toISOString().slice(0, 10);
  const outboxIds: string[] = [];
  let enqueued = 0;
  let skipped = 0;
  const elig = await getBankerAlertEligibility(dealId, sb);

  for (const channel of plan.channels) {
    const idempotencyKey = `banker_alert:${dealId}:${channel}:${purpose}:${today}`;
    const body = channel === "email" ? (plan.emailBody ?? "") : (plan.slackBody ?? "");
    const recipient = channel === "email" ? (elig.bankerEmail ?? "") : "slack-webhook";

    if (!recipient || (channel === "email" && !elig.bankerEmail)) { skipped++; continue; }

    const result = await enqueueCommsMessage({
      idempotencyKey,
      channel: channel === "slack" ? "slack" : "email",
      provider: channel === "slack" ? "slack" : "resend",
      recipient,
      subject: channel === "email" ? plan.emailSubject ?? undefined : undefined,
      body,
      dealId,
      triggerKey: purpose,
    }, sb);

    if (result.created) {
      enqueued++;
      outboxIds.push(result.id);
      await sb.from("brokerage_comms_ledger").insert({
        event_type: "banker_alert_enqueued",
        channel,
        deal_id: dealId,
        recipient_masked: channel === "email" ? (elig.bankerEmail ?? "").replace(/^(.).*(@.*)$/, "$1***$2") : "slack",
        metadata: { idempotencyKey, purpose },
        created_at: new Date().toISOString(),
      });
    } else {
      skipped++;
    }
  }

  return { enqueued, skipped, skipReason: null, outboxIds };
}

/**
 * Core logic for the Pulse ledger forwarder.
 *
 * Reads un-forwarded deal_pipeline_ledger events, redacts PII,
 * and forwards them to Pulse for Claude observer visibility.
 *
 * Concurrency-safe via claim-based locking:
 *   1. Reclaim stale claims (TTL expired)
 *   2. Select unclaimed candidates
 *   3. Claim each row atomically (claimed_at IS NULL guard)
 *   4. Forward claimed rows
 *   5. Mark forwarded or handle failure (deadletter after MAX_ATTEMPTS)
 *
 * Never throws. Never blocks Buddy.
 */

import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { redactLedgerPayload } from "@/lib/telemetry/pulseRedact";

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_DEFAULT = 50;
const MAX_CEILING = 200;
const CLAIM_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 10;
const INGEST_TIMEOUT_MS = 2000;

// ─── Types ──────────────────────────────────────────────────────────────────

type PulseEvent = {
  source: "buddy";
  env: string;
  deal_id: string;
  bank_id: string | null;
  event_key: string;
  created_at: string;
  trace_id: string;
  payload: unknown;
};

type LedgerRow = {
  id: string;
  deal_id: string;
  bank_id: string;
  event_key: string | null;
  stage: string;
  status: string;
  payload: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  error: string | null;
  ui_state: string | null;
  ui_message: string | null;
  created_at: string;
  pulse_forward_attempts: number | null;
};

export type ForwardResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  claimId?: string;
  attempted: number;
  forwarded: number;
  failed: number;
  deadlettered: number;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getEnv(): string {
  return process.env.BUDDY_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
}

function signBody(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function buildPulseEvent(row: LedgerRow, env: string): PulseEvent {
  const eventKey = row.event_key || row.stage;

  const rawPayload: Record<string, unknown> = {
    ...((row.payload as Record<string, unknown>) ?? {}),
    ...((row.meta as Record<string, unknown>) ?? {}),
    status: row.status,
    ui_state: row.ui_state,
    stage: row.stage,
  };

  if (row.error) {
    rawPayload.error_code = row.error.slice(0, 100);
  }

  return {
    source: "buddy",
    env,
    deal_id: row.deal_id,
    bank_id: row.bank_id ?? null,
    event_key: eventKey,
    created_at: row.created_at,
    trace_id: row.id,
    payload: redactLedgerPayload(rawPayload),
  };
}

const LEDGER_SELECT = [
  "id", "deal_id", "bank_id", "event_key", "stage", "status",
  "payload", "meta", "error", "ui_state", "ui_message",
  "created_at", "pulse_forward_attempts",
].join(", ");

// ─── Core ───────────────────────────────────────────────────────────────────

export async function forwardLedgerBatch(opts: {
  max?: number;
}): Promise<ForwardResult> {
  const max = Math.min(opts.max ?? MAX_DEFAULT, MAX_CEILING);

  // Kill switch
  if (process.env.PULSE_TELEMETRY_ENABLED !== "true") {
    return { ok: true, skipped: true, reason: "telemetry_disabled", attempted: 0, forwarded: 0, failed: 0, deadlettered: 0 };
  }

  const ingestUrl = process.env.PULSE_BUDDY_INGEST_URL;
  const ingestSecret = process.env.PULSE_BUDDY_INGEST_SECRET;
  if (!ingestUrl || !ingestSecret) {
    return { ok: true, skipped: true, reason: "no_ingest_config", attempted: 0, forwarded: 0, failed: 0, deadlettered: 0 };
  }

  const sb = supabaseAdmin();
  const env = getEnv();
  const claimId = crypto.randomUUID();
  const now = new Date().toISOString();
  const staleThreshold = new Date(Date.now() - CLAIM_TTL_MS).toISOString();

  // ── Step 1: Reclaim stale claims ────────────────────────────────────────
  await sb
    .from("deal_pipeline_ledger")
    .update({
      pulse_forward_claimed_at: null,
      pulse_forward_claim_id: null,
    } as any)
    .lt("pulse_forward_claimed_at", staleThreshold)
    .is("pulse_forwarded_at", null)
    .is("pulse_forward_deadletter_at", null);

  // ── Step 2: Select candidates ───────────────────────────────────────────
  const { data: candidates, error: selectErr } = await sb
    .from("deal_pipeline_ledger")
    .select("id, pulse_forward_attempts")
    .is("pulse_forwarded_at", null)
    .is("pulse_forward_deadletter_at", null)
    .is("pulse_forward_claimed_at", null)
    .order("created_at", { ascending: true })
    .limit(max);

  if (selectErr) {
    console.error("[pulse-forwarder] select candidates failed", selectErr.message);
    return { ok: false, reason: "select_failed", attempted: 0, forwarded: 0, failed: 0, deadlettered: 0 };
  }

  if (!candidates || candidates.length === 0) {
    return { ok: true, claimId, attempted: 0, forwarded: 0, failed: 0, deadlettered: 0 };
  }

  // ── Step 3: Claim each row atomically ───────────────────────────────────
  // The IS NULL guard on pulse_forward_claimed_at prevents double-claims
  // even if two workers selected the same candidate IDs.
  const claimed: LedgerRow[] = [];

  for (const candidate of candidates) {
    const newAttempts = (candidate.pulse_forward_attempts ?? 0) + 1;
    const { data } = await sb
      .from("deal_pipeline_ledger")
      .update({
        pulse_forward_claimed_at: now,
        pulse_forward_claim_id: claimId,
        pulse_forward_attempts: newAttempts,
      } as any)
      .eq("id", candidate.id)
      .is("pulse_forward_claimed_at", null)
      .select(LEDGER_SELECT)
      .maybeSingle();

    if (data) {
      claimed.push(data as unknown as LedgerRow);
    }
  }

  if (claimed.length === 0) {
    return { ok: true, claimId, attempted: 0, forwarded: 0, failed: 0, deadlettered: 0 };
  }

  // ── Step 4: Forward each claimed row ────────────────────────────────────
  let forwarded = 0;
  let failed = 0;
  let deadlettered = 0;

  for (const row of claimed) {
    const event = buildPulseEvent(row, env);
    const rawBody = JSON.stringify(event);
    const sig = signBody(rawBody, ingestSecret);

    try {
      const res = await fetch(ingestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-pulse-signature": sig,
        },
        body: rawBody,
        signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
      });

      if (res.ok) {
        // ── Step 5a: Mark forwarded, clear claim ────────────────────────
        await sb
          .from("deal_pipeline_ledger")
          .update({
            pulse_forwarded_at: new Date().toISOString(),
            pulse_forward_claimed_at: null,
            pulse_forward_claim_id: null,
          } as any)
          .eq("id", row.id);
        forwarded++;
      } else {
        // ── Step 5b: Mark failure ───────────────────────────────────────
        const dl = await markFailure(sb, row, `HTTP ${res.status}`);
        if (dl) deadlettered++;
        failed++;
      }
    } catch (err: any) {
      const dl = await markFailure(sb, row, err?.message?.slice(0, 200) ?? "unknown");
      if (dl) deadlettered++;
      failed++;
    }
  }

  return { ok: true, claimId, attempted: claimed.length, forwarded, failed, deadlettered };
}

/**
 * Mark a forwarding failure. Returns true if the row was deadlettered.
 */
async function markFailure(
  sb: ReturnType<typeof supabaseAdmin>,
  row: LedgerRow,
  errorMsg: string,
): Promise<boolean> {
  const attempts = row.pulse_forward_attempts ?? 0;
  const isDeadletter = attempts >= MAX_ATTEMPTS;

  const update: Record<string, unknown> = {
    pulse_forward_error: errorMsg,
    pulse_forward_claimed_at: null,
    pulse_forward_claim_id: null,
  };

  if (isDeadletter) {
    update.pulse_forward_deadletter_at = new Date().toISOString();
  }

  await sb
    .from("deal_pipeline_ledger")
    .update(update as any)
    .eq("id", row.id);

  return isDeadletter;
}

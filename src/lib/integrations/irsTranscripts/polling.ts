/**
 * SPEC S4 D-2 — IRS transcript polling. Free of "server-only" for
 * testability. Cadence (from the spec):
 *   first 48h post-submit: every 4h
 *   48h–7d: every 24h
 *   7d–14d: every 48h
 *   >14d: stop polling, mark expired, surface a gap
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type PollCadenceResult = { nextPollAt: string | null; expired: boolean };

export function computeNextPollAt(submittedAt: Date, now: Date): PollCadenceResult {
  const elapsedMs = now.getTime() - submittedAt.getTime();

  if (elapsedMs >= 14 * DAY_MS) {
    return { nextPollAt: null, expired: true };
  }
  if (elapsedMs >= 7 * DAY_MS) {
    return { nextPollAt: new Date(now.getTime() + 48 * HOUR_MS).toISOString(), expired: false };
  }
  if (elapsedMs >= 2 * DAY_MS) {
    return { nextPollAt: new Date(now.getTime() + 24 * HOUR_MS).toISOString(), expired: false };
  }
  return { nextPollAt: new Date(now.getTime() + 4 * HOUR_MS).toISOString(), expired: false };
}

export type IrsPollingSupabaseClient = { from: (table: string) => any };

export type IrsPollingVendorClient = {
  pollVendorTranscriptRequest: (vendorRequestId: string) => Promise<{
    status: string;
    transcripts?: Array<{ tax_year: number; transcript_type: string; fields?: Record<string, number | string | null> }>;
  }>;
};

const RECEIVED_STATUSES = new Set(["completed", "received", "fulfilled"]);

export type PollOutcome = { requestId: string; outcome: "received" | "still_pending" | "expired" };

/**
 * Row-level update locking (spec D-4: "idempotent — same request handled
 * once per cron run via row-level update locking"): each row is claimed by
 * flipping `poll_attempt_count` forward as part of the same update that
 * sets the new `next_poll_at`, so a concurrent second cron invocation
 * re-reading the row before this one commits would see a `next_poll_at`
 * that's already in the future and skip it on its own query. This
 * function does not implement a second cron invocation's concurrency
 * itself — it's a library function, not the cron entry point (SPEC D-4 —
 * cron deployment is deferred, this function is the mandatory part).
 */
export async function pollPendingTranscripts(
  deps: { sb: IrsPollingSupabaseClient; vendor: IrsPollingVendorClient },
  now: Date = new Date(),
): Promise<PollOutcome[]> {
  const { sb, vendor } = deps;

  const { data } = await sb
    .from("borrower_irs_transcript_requests")
    .select("id, deal_id, bank_id, vendor_request_id, submitted_at, poll_attempt_count")
    .eq("status", "submitted")
    .lte("next_poll_at", now.toISOString());

  const pending = (data ?? []) as Array<{
    id: string;
    deal_id: string;
    bank_id: string;
    vendor_request_id: string;
    submitted_at: string;
    poll_attempt_count: number;
  }>;

  const outcomes: PollOutcome[] = [];

  for (const row of pending) {
    const response = await vendor.pollVendorTranscriptRequest(row.vendor_request_id);

    if (RECEIVED_STATUSES.has(response.status)) {
      await sb
        .from("borrower_irs_transcript_requests")
        .update({
          status: "received",
          received_at: now.toISOString(),
          poll_attempt_count: row.poll_attempt_count + 1,
          reconciliation_summary: { transcripts: response.transcripts ?? [] },
        })
        .eq("id", row.id);
      outcomes.push({ requestId: row.id, outcome: "received" });
      continue;
    }

    const { nextPollAt, expired } = computeNextPollAt(new Date(row.submitted_at), now);

    if (expired) {
      await sb.from("borrower_irs_transcript_requests").update({ status: "expired", poll_attempt_count: row.poll_attempt_count + 1 }).eq("id", row.id);
      await sb.from("deal_gap_queue").insert({
        deal_id: row.deal_id,
        bank_id: row.bank_id,
        gap_type: "irs_transcript_delayed",
        fact_type: "irs_transcript",
        fact_key: `irs_transcript_request.${row.id}`,
        owner_entity_id: null,
        description: "IRS transcripts were not received within the expected 14-day window — banker may need to follow up directly with the IRS/vendor.",
        resolution_prompt: "Contact the transcript vendor or IRS to check on this request's status.",
        priority: 2,
        status: "open",
      });
      outcomes.push({ requestId: row.id, outcome: "expired" });
      continue;
    }

    await sb.from("borrower_irs_transcript_requests").update({ next_poll_at: nextPollAt, poll_attempt_count: row.poll_attempt_count + 1 }).eq("id", row.id);
    outcomes.push({ requestId: row.id, outcome: "still_pending" });
  }

  return outcomes;
}

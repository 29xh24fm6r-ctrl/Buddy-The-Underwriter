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

function persistenceError(operation: string): Error {
  return new Error(`IRS transcript persistence failed: ${operation}`);
}

function requireReturnedRow(
  operation: string,
  error: unknown,
  data: unknown,
  predicate: (row: Record<string, unknown>) => boolean,
): void {
  if (error || !Array.isArray(data) || data.length !== 1 || !predicate(data[0] as Record<string, unknown>)) {
    throw persistenceError(operation);
  }
}

export type PollOutcome = { requestId: string; outcome: "received" | "still_pending" | "expired" };

/**
 * Compare-and-set request transitions implement the spec D-4 concurrency
 * boundary. A concurrent invocation may observe the same submitted request,
 * but only one can mutate it: every update requires the row to remain
 * `submitted` and proves the exact returned id, state, attempt count, and
 * cursor before reporting an outcome. A lost claim therefore fails closed
 * instead of producing a second successful transition.
 */
export async function pollPendingTranscripts(
  deps: { sb: IrsPollingSupabaseClient; vendor: IrsPollingVendorClient },
  now: Date = new Date(),
): Promise<PollOutcome[]> {
  const { sb, vendor } = deps;

  const { data, error: pendingError } = await sb
    .from("borrower_irs_transcript_requests")
    .select("id, deal_id, bank_id, vendor_request_id, submitted_at, poll_attempt_count")
    .eq("status", "submitted")
    .lte("next_poll_at", now.toISOString());

  if (pendingError) {
    throw persistenceError("load pending requests");
  }

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
    const nextAttemptCount = row.poll_attempt_count + 1;
    const response = await vendor.pollVendorTranscriptRequest(row.vendor_request_id);

    if (RECEIVED_STATUSES.has(response.status)) {
      const receivedUpdate = await sb
        .from("borrower_irs_transcript_requests")
        .update({
          status: "received",
          received_at: now.toISOString(),
          poll_attempt_count: nextAttemptCount,
          reconciliation_summary: { transcripts: response.transcripts ?? [] },
        })
        .eq("id", row.id)
        .eq("status", "submitted")
        .select("id, status, poll_attempt_count");
      requireReturnedRow(
        "mark request received",
        receivedUpdate.error,
        receivedUpdate.data,
        (updated) =>
          updated.id === row.id &&
          updated.status === "received" &&
          updated.poll_attempt_count === nextAttemptCount,
      );
      outcomes.push({ requestId: row.id, outcome: "received" });
      continue;
    }

    const { nextPollAt, expired } = computeNextPollAt(new Date(row.submitted_at), now);

    if (expired) {
      const expiredUpdate = await sb
        .from("borrower_irs_transcript_requests")
        .update({ status: "expired", poll_attempt_count: nextAttemptCount })
        .eq("id", row.id)
        .eq("status", "submitted")
        .select("id, status, poll_attempt_count");
      requireReturnedRow(
        "mark request expired",
        expiredUpdate.error,
        expiredUpdate.data,
        (updated) =>
          updated.id === row.id &&
          updated.status === "expired" &&
          updated.poll_attempt_count === nextAttemptCount,
      );

      const gapKey = `irs_transcript_request.${row.id}`;
      const gapInsert = await sb
        .from("deal_gap_queue")
        .insert({
          deal_id: row.deal_id,
          bank_id: row.bank_id,
          gap_type: "irs_transcript_delayed",
          fact_type: "irs_transcript",
          fact_key: gapKey,
          owner_entity_id: null,
          description: "IRS transcripts were not received within the expected 14-day window — banker may need to follow up directly with the IRS/vendor.",
          resolution_prompt: "Contact the transcript vendor or IRS to check on this request's status.",
          priority: 2,
          status: "open",
        })
        .select("id, fact_key, status");
      requireReturnedRow(
        "persist delayed-transcript gap",
        gapInsert.error,
        gapInsert.data,
        (inserted) => typeof inserted.id === "string" && inserted.fact_key === gapKey && inserted.status === "open",
      );
      outcomes.push({ requestId: row.id, outcome: "expired" });
      continue;
    }

    const pendingUpdate = await sb
      .from("borrower_irs_transcript_requests")
      .update({ next_poll_at: nextPollAt, poll_attempt_count: nextAttemptCount })
      .eq("id", row.id)
      .eq("status", "submitted")
      .select("id, status, poll_attempt_count, next_poll_at");
    requireReturnedRow(
      "advance request polling cursor",
      pendingUpdate.error,
      pendingUpdate.data,
      (updated) =>
        updated.id === row.id &&
        updated.status === "submitted" &&
        updated.poll_attempt_count === nextAttemptCount &&
        updated.next_poll_at === nextPollAt,
    );
    outcomes.push({ requestId: row.id, outcome: "still_pending" });
  }

  return outcomes;
}

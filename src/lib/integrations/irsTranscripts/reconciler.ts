/**
 * SPEC S4 D-2 — IRS transcript reconciliation. Free of "server-only" for
 * testability. Documented assumption: transcript field keys from the
 * vendor are assumed pre-normalized to the same `fact_key` vocabulary
 * `deal_financial_facts` already uses (e.g. "agi", "gross_receipts") —
 * there's no live vendor account to confirm the real field names against
 * (same PIV-3 gap noted in creditBureau/parser.ts), so the matching logic
 * here (find same fact_key + same tax year, flag >$1,000 abs difference)
 * is what's real and load-bearing; the exact key strings are a mapping
 * detail to confirm once a vendor is live.
 */

export type TranscriptFieldSet = {
  tax_year: number;
  transcript_type: string;
  fields?: Record<string, number | string | null>;
};

export type BorrowerFact = {
  fact_key: string;
  fact_value_num: number | null;
  fact_period_end: string;
};

export type Discrepancy = {
  fact_key: string;
  tax_year: number;
  transcript_value: number;
  borrower_value: number;
  abs_diff: number;
};

const MATERIALITY_THRESHOLD = 1000;

export function findDiscrepancies(transcripts: TranscriptFieldSet[], borrowerFacts: BorrowerFact[]): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];

  for (const t of transcripts) {
    for (const [key, value] of Object.entries(t.fields ?? {})) {
      if (typeof value !== "number") continue;

      const matchingFact = borrowerFacts.find(
        (f) => f.fact_key === key && new Date(f.fact_period_end).getUTCFullYear() === t.tax_year && f.fact_value_num != null,
      );
      if (!matchingFact || matchingFact.fact_value_num == null) continue;

      const absDiff = Math.abs(value - matchingFact.fact_value_num);
      if (absDiff > MATERIALITY_THRESHOLD) {
        discrepancies.push({ fact_key: key, tax_year: t.tax_year, transcript_value: value, borrower_value: matchingFact.fact_value_num, abs_diff: absDiff });
      }
    }
  }

  return discrepancies;
}

export type IrsReconcilerSupabaseClient = { from: (table: string) => any };

export type ReconcileTranscriptRequestResult =
  | { ok: true; discrepancyCount: number }
  | { ok: false; reason: "REQUEST_NOT_FOUND" | "NOT_YET_RECEIVED" };

export async function reconcileTranscriptRequest(requestId: string, deps: { sb: IrsReconcilerSupabaseClient }): Promise<ReconcileTranscriptRequestResult> {
  const { sb } = deps;

  const { data: request } = await sb
    .from("borrower_irs_transcript_requests")
    .select("id, deal_id, bank_id, ownership_entity_id, status, reconciliation_summary")
    .eq("id", requestId)
    .maybeSingle();

  if (!request) {
    return { ok: false, reason: "REQUEST_NOT_FOUND" };
  }
  if (request.status !== "received") {
    return { ok: false, reason: "NOT_YET_RECEIVED" };
  }

  const transcripts = ((request.reconciliation_summary?.transcripts ?? []) as TranscriptFieldSet[]);

  const { data: facts } = await sb
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num, fact_period_end")
    .eq("deal_id", request.deal_id)
    .eq("is_superseded", false);

  const discrepancies = findDiscrepancies(transcripts, (facts ?? []) as BorrowerFact[]);

  if (discrepancies.length > 0) {
    await sb.from("deal_gap_queue").insert(
      discrepancies.map((d) => ({
        deal_id: request.deal_id,
        bank_id: request.bank_id,
        gap_type: "irs_transcript_discrepancy",
        fact_type: "irs_reconciliation",
        fact_key: d.fact_key,
        owner_entity_id: request.ownership_entity_id,
        description: `IRS transcript shows ${d.fact_key} = $${d.transcript_value.toLocaleString()} for ${d.tax_year}, but the borrower-provided figure was $${d.borrower_value.toLocaleString()} (difference of $${d.abs_diff.toLocaleString()}). Please explain.`,
        resolution_prompt: `Review the ${d.tax_year} ${d.fact_key} discrepancy against the IRS transcript.`,
        priority: 2,
        status: "open",
      })),
    );
  }

  await sb
    .from("borrower_irs_transcript_requests")
    .update({ status: "reconciled", reconciliation_summary: { transcripts, discrepancies } })
    .eq("id", requestId);

  await sb.from("deal_events").insert({
    deal_id: request.deal_id,
    kind: "irs.reconciliation_completed",
    payload: { request_id: requestId, discrepancy_count: discrepancies.length },
  });

  return { ok: true, discrepancyCount: discrepancies.length };
}

/**
 * Server-side deal context for route handlers and library code that need the
 * deal's tenant and headline fields without re-implementing the lookup.
 *
 * This used to call the app's own GET /api/deals/[dealId]/context over HTTP,
 * falling back to a local dev origin when no site URL was configured. On
 * Vercel nothing listens there (ECONNREFUSED) and, even with a correct base
 * URL, the request carries no Clerk session, so every caller
 * (decision finalize, attest, diff, PDF, committee minutes, pack apply)
 * failed in production. The deal row is read in-process instead.
 *
 * Tenant enforcement stays with the caller: route handlers compare
 * `deal.bank_id` against the session's bank, exactly as before. This helper
 * never consults the Clerk session, so it is safe from worker contexts too.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export type DealContextRow = {
  id: string;
  bank_id: string | null;
  borrower_name: string | null;
  entity_type: string | null;
  stage: string | null;
  risk_score: number | null;
  created_at: string | null;
};

export type DealContextResponse =
  | {
      ok: true;
      deal: { id: string; bank_id: string | null; created_at: string | null };
      server_ts: string;
      dealId: string;
      stage: string;
      borrower: { name: string; entityType: string };
      risk: { score: number };
    }
  | { ok: false; error: string; details?: string | null; dealId?: string | null };

/** Reads the deal row; injected by tests. */
export type DealContextReader = (
  dealId: string,
) => Promise<{ data: DealContextRow | null; error: { message: string } | null }>;

async function readDealRow(dealId: string) {
  const { data, error } = await supabaseAdmin()
    .from("deals")
    .select("id, bank_id, borrower_name, entity_type, stage, risk_score, created_at")
    .eq("id", dealId)
    .maybeSingle();
  return { data: (data as DealContextRow | null) ?? null, error };
}

/**
 * Load the deal's context in-process. Never throws on a missing deal; returns
 * `{ ok: false }` so callers keep their existing not-found handling.
 */
export async function fetchDealContext(
  dealId: string,
  opts?: { readDeal?: DealContextReader },
): Promise<DealContextResponse> {
  const id = typeof dealId === "string" ? dealId.trim() : "";
  if (!id) return { ok: false, error: "missing_deal_id", dealId: null };

  const read = opts?.readDeal ?? readDealRow;
  let result: Awaited<ReturnType<DealContextReader>>;
  try {
    result = await read(id);
  } catch (e: any) {
    return { ok: false, error: "deal_load_failed", details: e?.message ?? String(e), dealId: id };
  }
  if (result.error) {
    return { ok: false, error: "deal_query_error", details: result.error.message, dealId: id };
  }
  const deal = result.data;
  if (!deal) {
    return { ok: false, error: "deal_not_found", dealId: id };
  }

  return {
    ok: true,
    deal: { id: deal.id, bank_id: deal.bank_id ?? null, created_at: deal.created_at ?? null },
    server_ts: new Date().toISOString(),
    dealId: deal.id,
    stage: deal.stage ?? "intake",
    borrower: {
      name: deal.borrower_name ?? "Unknown Borrower",
      entityType: deal.entity_type ?? "Unknown",
    },
    risk: { score: typeof deal.risk_score === "number" ? deal.risk_score : 0 },
  };
}

/**
 * Lightweight variant that just checks the deal exists and returns its bank_id.
 * Throws if the deal is not found or has no bank_id.
 */
export async function fetchDealBankId(
  dealId: string,
  opts?: { readDeal?: DealContextReader },
): Promise<string> {
  const ctx = await fetchDealContext(dealId, opts);
  if (!ctx.ok) {
    throw new Error(`Deal not found: ${ctx.error}`);
  }
  if (!ctx.deal.bank_id) {
    throw new Error(`Deal ${dealId} has no bank_id (should have been auto-assigned)`);
  }
  return ctx.deal.bank_id;
}

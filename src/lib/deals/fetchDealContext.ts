/**
 * Server-side helper to fetch deal context via the canonical /context endpoint.
 * 
 * This ensures:
 * - Consistent tenant enforcement (bank_id checks + auto-assignment)
 * - No duplicate deal-fetching logic
 * - Single contract to evolve forever
 * 
 * Usage:
 * ```typescript
 * const context = await fetchDealContext(dealId);
 * if (!context.ok) throw new Error(context.error);
 * // context.deal.bank_id is guaranteed
 * ```
 */

type DealContextResponse =
  | {
      ok: true;
      deal: { id: string; bank_id: string | null; created_at: string | null };
      ensured_bank: { ok: true; bankId: string; updated: boolean } | null;
      server_ts: string;
      // Legacy fields preserved
      dealId: string;
      stage: string;
      borrower: { name: string; entityType: string };
      risk: { score: number; flags: string[] };
      completeness: { missingDocs: number; openConditions: number };
      permissions: { canApprove: boolean; canRequest: boolean; canShare: boolean };
    }
  | { ok: false; error: string; details?: string | null; dealId?: string | null };

/**
 * Fetch deal context from the canonical /context endpoint.
 * Throws on network errors or non-ok responses.
 */
export async function fetchDealContext(dealId: string): Promise<DealContextResponse> {
  // In server-side Next.js, we can use internal fetch or direct import
  // For now, use fetch with absolute URL (works in both dev + production)
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  
  const res = await fetch(`${baseUrl}/api/deals/${dealId}/context`, {
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(
      `fetchDealContext failed: ${res.status} - ${json.error ?? "unknown error"}`
    );
  }

  return json as DealContextResponse;
}

/**
 * Lightweight variant that just checks if deal exists + extracts bank_id.
 * Throws if deal not found or bank_id missing.
 */
export async function fetchDealBankId(dealId: string): Promise<string> {
  const ctx = await fetchDealContext(dealId);
  if (!ctx.ok) {
    throw new Error(`Deal not found: ${ctx.error}`);
  }
  if (!ctx.deal.bank_id) {
    throw new Error(`Deal ${dealId} has no bank_id (should have been auto-assigned)`);
  }
  return ctx.deal.bank_id;
}

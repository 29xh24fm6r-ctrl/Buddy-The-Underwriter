/**
 * Pure helper: pick the latest phone_e164 per deal from borrower_phone_links rows.
 *
 * Rows are expected newest-first (ORDER BY created_at DESC), so the first
 * occurrence per deal_id wins. Rows with a null deal_id are skipped.
 *
 * Kept in its own module (no "server-only" import) so it can be unit-tested
 * under `node --test --import tsx` — selectCandidates.ts itself is server-only
 * and therefore not importable in the unit runner.
 *
 * SPEC-REMINDERS-PHONE-SOURCE-1.
 */
export function pickLatestPhoneByDeal(
  rows: Array<{ deal_id: string | null; phone_e164: string; created_at: string }>
): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    if (!r.deal_id) continue;
    if (!out.has(r.deal_id)) out.set(r.deal_id, r.phone_e164); // rows arrive newest-first
  }
  return out;
}

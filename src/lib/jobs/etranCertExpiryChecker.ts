/**
 * ARC-00 Phase 6 (SPEC S5 B-7) — background job library function (same
 * "library function is the mandatory part, cron wiring/notification
 * delivery is infra scope" boundary as staleSignatureChecker.ts). No
 * "server-only" — injectable client.
 *
 * `bank_etran_credentials` is bank-scoped, not deal-scoped, so unlike
 * every other checker in this arc this finding has no natural home in
 * `deal_gap_queue` (which requires a `deal_id`) — there is no bank-level
 * gap/notification sink anywhere in this schema. This function therefore
 * only detects; the cron route logs the result. Building a real bank-admin
 * notification channel (email/in-app banner) is separate schema+infra
 * work, flagged in the Drift Log rather than invented here.
 */

export type EtranCertExpiryCheckerClient = { from: (table: string) => any };

export type ExpiringEtranCredential = {
  bank_id: string;
  sba_lender_id: string;
  cert_expires_at: string;
  days_remaining: number;
  status: "expired" | "expiring_soon";
};

const WARNING_WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;

/**
 * Returns bank_etran_credentials rows whose cert_expires_at is within the
 * next 30 days (including already-expired). Rows with no cert_expires_at
 * set are excluded — nothing to warn about.
 */
export async function findExpiringEtranCredentials(
  sb: EtranCertExpiryCheckerClient,
  now: Date = new Date(),
): Promise<ExpiringEtranCredential[]> {
  const cutoff = new Date(now.getTime() + WARNING_WINDOW_DAYS * MS_PER_DAY).toISOString();

  const { data } = await sb
    .from("bank_etran_credentials")
    .select("bank_id, sba_lender_id, cert_expires_at")
    .not("cert_expires_at", "is", null)
    .lte("cert_expires_at", cutoff);

  const rows = (data ?? []) as Array<{ bank_id: string; sba_lender_id: string; cert_expires_at: string }>;

  return rows.map((r) => {
    const daysRemaining = Math.round((new Date(r.cert_expires_at).getTime() - now.getTime()) / MS_PER_DAY);
    return {
      bank_id: r.bank_id,
      sba_lender_id: r.sba_lender_id,
      cert_expires_at: r.cert_expires_at,
      days_remaining: daysRemaining,
      status: daysRemaining < 0 ? "expired" : "expiring_soon",
    };
  });
}

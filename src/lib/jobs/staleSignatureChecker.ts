/**
 * SPEC S3 D-1 — background job library function (cron deployment optional
 * per spec addendum; this function + its tests are the mandatory part).
 * No "server-only" — injectable client, same testable pattern as the rest
 * of this arc's service modules.
 */

export type StaleSignatureCheckerClient = { from: (table: string) => any };

export type StaleSignature = {
  deal_id: string;
  form_code: string;
  signer_id: string | null;
  expires_at: string;
  days_remaining: number;
};

const WARNING_WINDOW_DAYS = 14;
const MS_PER_DAY = 86_400_000;

/**
 * Returns signed_documents rows whose expires_at falls within the next 14
 * days (including already-expired). idx_sd_expiring is a plain index on
 * expires_at (see 20260513_signed_documents.sql — the spec's original
 * `WHERE expires_at > NOW()` partial-index predicate isn't IMMUTABLE and
 * can't be created; filtering "within 14 days" happens here instead).
 */
export async function findStaleSignatures(sb: StaleSignatureCheckerClient): Promise<StaleSignature[]> {
  const cutoff = new Date(Date.now() + WARNING_WINDOW_DAYS * MS_PER_DAY).toISOString();

  const { data } = await sb
    .from("signed_documents")
    .select("deal_id, form_code, signer_ownership_entity_id, expires_at")
    .lte("expires_at", cutoff);

  const rows = (data ?? []) as Array<{
    deal_id: string;
    form_code: string;
    signer_ownership_entity_id: string | null;
    expires_at: string;
  }>;

  return rows.map((r) => ({
    deal_id: r.deal_id,
    form_code: r.form_code,
    signer_id: r.signer_ownership_entity_id,
    expires_at: r.expires_at,
    days_remaining: Math.round((new Date(r.expires_at).getTime() - Date.now()) / MS_PER_DAY),
  }));
}

/**
 * Inserts one deal_gap_queue row per stale finding so the banker sees
 * "Form 1919 expires in 8 days — re-sign before submission" in the Story
 * tab's gap-resolution flow. Idempotent-ish: callers running this daily
 * will re-insert a new gap row each run unless deal_gap_queue gets a
 * dedup constraint — out of scope here (cron deployment itself is
 * deferred per spec addendum; this is the library function only).
 */
export async function writeStaleSignatureGaps(
  sb: StaleSignatureCheckerClient,
  findings: StaleSignature[],
): Promise<number> {
  if (findings.length === 0) return 0;

  const rows = findings.map((f) => ({
    deal_id: f.deal_id,
    gap_type: "sba_signature_stale",
    fact_key: `signed_documents.${f.form_code}`,
    owner_entity_id: f.signer_id,
    description:
      f.days_remaining >= 0
        ? `${f.form_code.replace("FORM_", "Form ")} expires in ${f.days_remaining} day${f.days_remaining === 1 ? "" : "s"} — re-sign before submission.`
        : `${f.form_code.replace("FORM_", "Form ")} expired ${Math.abs(f.days_remaining)} day${Math.abs(f.days_remaining) === 1 ? "" : "s"} ago — re-sign before submission.`,
    resolution_prompt: `Request a fresh signature for ${f.form_code.replace("FORM_", "Form ")}.`,
    priority: f.days_remaining < 0 ? 1 : 2,
    status: "open",
  }));

  await sb.from("deal_gap_queue").insert(rows);
  return rows.length;
}

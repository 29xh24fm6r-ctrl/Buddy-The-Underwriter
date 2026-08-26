/**
 * SPEC S3 D-1 — scheduled stale-signature lifecycle reconciliation.
 *
 * The executed-signature table is immutable history: re-signing creates a
 * second row. A lifecycle checker therefore must evaluate only the latest
 * signature for each deal/form/signer, not every historical row.
 */

export type StaleSignatureCheckerClient = { from: (table: string) => any };

export type StaleSignature = {
  deal_id: string;
  bank_id: string;
  form_code: string;
  signer_id: string | null;
  signer_role: string;
  expires_at: string;
  days_remaining: number;
};

type SignedDocumentRow = {
  id: string;
  deal_id: string;
  bank_id: string;
  form_code: string;
  signer_ownership_entity_id: string | null;
  signer_role: string;
  signature_completed_at: string;
  expires_at: string;
};

const WARNING_WINDOW_DAYS = 14;
const MS_PER_DAY = 86_400_000;
const PAGE_SIZE = 1_000;

function signerKey(row: Pick<SignedDocumentRow, "signer_ownership_entity_id" | "signer_role">): string {
  return row.signer_ownership_entity_id ?? `role:${row.signer_role}`;
}

function signatureLifecycleKey(
  row: Pick<SignedDocumentRow, "deal_id" | "bank_id" | "form_code" | "signer_ownership_entity_id" | "signer_role">,
): string {
  return [row.deal_id, row.bank_id, row.form_code, signerKey(row)].join("|");
}

function staleGapFactKey(finding: Pick<StaleSignature, "form_code" | "signer_id" | "signer_role">): string {
  return `signed_documents.${finding.form_code}.${finding.signer_id ?? `role:${finding.signer_role}`}`;
}

function dbError(operation: string, error: unknown): Error {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  return new Error(`stale_signature_${operation}_failed: ${message}`);
}

async function readLatestSignatures(sb: StaleSignatureCheckerClient): Promise<SignedDocumentRow[]> {
  const rows: SignedDocumentRow[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("signed_documents")
      .select(
        "id, deal_id, bank_id, form_code, signer_ownership_entity_id, signer_role, signature_completed_at, expires_at",
      )
      .order("signature_completed_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw dbError("read", error);

    const page = (data ?? []) as SignedDocumentRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const latest = new Map<string, SignedDocumentRow>();
  for (const row of rows) {
    const key = signatureLifecycleKey(row);
    if (!latest.has(key)) latest.set(key, row);
  }
  return [...latest.values()];
}

/**
 * Returns only the current signature state whose expiry falls within the next
 * 14 days (including already-expired). Historical signatures superseded by a
 * later completed ceremony are deliberately ignored.
 */
export async function findStaleSignatures(sb: StaleSignatureCheckerClient): Promise<StaleSignature[]> {
  const cutoffMs = Date.now() + WARNING_WINDOW_DAYS * MS_PER_DAY;
  const latest = await readLatestSignatures(sb);

  return latest
    .filter((row) => new Date(row.expires_at).getTime() <= cutoffMs)
    .map((row) => ({
      deal_id: row.deal_id,
      bank_id: row.bank_id,
      form_code: row.form_code,
      signer_id: row.signer_ownership_entity_id,
      signer_role: row.signer_role,
      expires_at: row.expires_at,
      days_remaining: Math.round((new Date(row.expires_at).getTime() - Date.now()) / MS_PER_DAY),
    }));
}

/**
 * Upserts one signer-specific gap per current stale finding. Database write
 * errors are fatal so the cron cannot claim work was persisted when it was not.
 */
export async function writeStaleSignatureGaps(
  sb: StaleSignatureCheckerClient,
  findings: StaleSignature[],
): Promise<number> {
  if (findings.length === 0) return 0;

  const rows = findings.map((f) => ({
    deal_id: f.deal_id,
    bank_id: f.bank_id,
    gap_type: "sba_signature_stale",
    fact_type: "sba_form_signature",
    fact_key: staleGapFactKey(f),
    owner_entity_id: f.signer_id,
    description:
      f.days_remaining >= 0
        ? `${f.form_code.replace("FORM_", "Form ")} expires in ${f.days_remaining} day${f.days_remaining === 1 ? "" : "s"} — re-sign before submission.`
        : `${f.form_code.replace("FORM_", "Form ")} expired ${Math.abs(f.days_remaining)} day${Math.abs(f.days_remaining) === 1 ? "" : "s"} ago — re-sign before submission.`,
    resolution_prompt: `Request a fresh signature for ${f.form_code.replace("FORM_", "Form ")}.`,
    priority: f.days_remaining < 0 ? 1 : 2,
    status: "open",
  }));

  const { error } = await sb
    .from("deal_gap_queue")
    .upsert(rows, { onConflict: "deal_id,fact_type,fact_key,gap_type,status" });
  if (error) throw dbError("gap_upsert", error);
  return rows.length;
}

async function resolveSupersededStaleSignatureGaps(
  sb: StaleSignatureCheckerClient,
  findings: StaleSignature[],
): Promise<number> {
  const { data, error } = await sb
    .from("deal_gap_queue")
    .select("id, deal_id, fact_key, owner_entity_id")
    .eq("gap_type", "sba_signature_stale")
    .eq("status", "open");
  if (error) throw dbError("open_gap_read", error);

  const active = new Set(
    findings.map((finding) =>
      [finding.deal_id, staleGapFactKey(finding), finding.signer_id ?? ""].join("|"),
    ),
  );
  const staleGaps = ((data ?? []) as Array<{
    id: string;
    deal_id: string;
    fact_key: string;
    owner_entity_id: string | null;
  }>).filter(
    (gap) =>
      !active.has([gap.deal_id, gap.fact_key, gap.owner_entity_id ?? ""].join("|")),
  );

  if (staleGaps.length === 0) return 0;

  // Production's constraint is full rather than the partial-open index in the
  // migration. Archive each resolved record under an id-qualified fact key so
  // a future stale → fresh → stale cycle cannot collide with prior history.
  await Promise.all(
    staleGaps.map(async (gap) => {
      const { error: updateError } = await sb
        .from("deal_gap_queue")
        .update({
          fact_key: `${gap.fact_key}.resolved.${gap.id}`,
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolution_meta: {
            action: "superseded_by_current_signature",
            original_fact_key: gap.fact_key,
          },
        })
        .eq("id", gap.id)
        .eq("status", "open");
      if (updateError) throw dbError("gap_resolve", updateError);
    }),
  );
  return staleGaps.length;
}

/**
 * Reconciles the whole scheduled lifecycle: compute current stale signatures,
 * persist active gaps, and close any stale-signature gap no longer backed by
 * the latest executed document.
 */
export async function reconcileStaleSignatureGaps(
  sb: StaleSignatureCheckerClient,
): Promise<{ findings: StaleSignature[]; gapsWritten: number; gapsResolved: number }> {
  const findings = await findStaleSignatures(sb);
  const gapsWritten = await writeStaleSignatureGaps(sb, findings);
  const gapsResolved = await resolveSupersededStaleSignatureGaps(sb, findings);
  return { findings, gapsWritten, gapsResolved };
}

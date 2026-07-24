/**
 * Recurring check: are the SBA/IRS PDFs Buddy has on file still the
 * currently-published ones? No "server-only" — injectable client, same
 * testable pattern as staleSignatureChecker.ts/thirdPartyOverdueChecker.ts.
 *
 * This is a GLOBAL (bank_id IS NULL) concern, not a per-deal one — there is
 * no deal_gap_queue-style sink for it (that table requires deal_id). Same
 * situation etran-cert-expiry already hit; findings are written back onto
 * bank_document_templates itself (last_checked_at/is_stale) so they're at
 * least durable and queryable, plus logged the same way etran-cert-expiry
 * logs its findings until a real admin-alert sink exists.
 */

import { resolveCurrentTemplateRevision } from "@/lib/sba/templates/resolveCurrentTemplateRevision";
import { OFFICIAL_TEMPLATE_SOURCES } from "@/lib/sba/templates/officialTemplateSources";

export type TemplateStalenessCheckerClient = { from: (table: string) => any };

export type TemplateStalenessFinding = {
  templateKey: string;
  templateRowId: string | null;
  ok: boolean;
  isStale: boolean;
  storedRevision: string | null;
  liveRevision: string | null;
  storedSha256: string | null;
  liveSha256: string | null;
  error?: string;
};

export async function findTemplateStaleness(
  sb: TemplateStalenessCheckerClient,
): Promise<TemplateStalenessFinding[]> {
  const findings: TemplateStalenessFinding[] = [];

  for (const source of OFFICIAL_TEMPLATE_SOURCES) {
    const { data: row } = await sb
      .from("bank_document_templates")
      .select("id, version, file_sha256, metadata")
      .is("bank_id", null)
      .eq("template_key", source.templateKey)
      .maybeSingle();

    const storedRevision = (row as { version?: string } | null)?.version ?? null;
    const storedSha256 = (row as { file_sha256?: string } | null)?.file_sha256 ?? null;

    try {
      const live = await resolveCurrentTemplateRevision(source.sourcePageUrl);
      const isStale = !row || live.sha256 !== storedSha256;
      findings.push({
        templateKey: source.templateKey,
        templateRowId: (row as { id?: string } | null)?.id ?? null,
        ok: true,
        isStale,
        storedRevision,
        liveRevision: live.revision,
        storedSha256,
        liveSha256: live.sha256,
      });
    } catch (err: unknown) {
      findings.push({
        templateKey: source.templateKey,
        templateRowId: (row as { id?: string } | null)?.id ?? null,
        ok: false,
        isStale: false,
        storedRevision,
        liveRevision: null,
        storedSha256,
        liveSha256: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return findings;
}

/**
 * Records every successful check's result on bank_document_templates
 * (last_checked_at always; is_stale only meaningfully known when ok=true).
 * A failed resolution (network error, page structure changed) does NOT
 * mark a template stale — "we couldn't check" and "we checked and it
 * changed" are different findings and must not be conflated into a false
 * stale flag.
 */
export async function writeTemplateStalenessFindings(
  sb: TemplateStalenessCheckerClient,
  findings: TemplateStalenessFinding[],
): Promise<number> {
  let written = 0;
  const now = new Date().toISOString();

  for (const f of findings) {
    if (!f.templateRowId) continue;
    const patch: Record<string, unknown> = { last_checked_at: now };
    if (f.ok) patch.is_stale = f.isStale;

    await sb.from("bank_document_templates").update(patch).eq("id", f.templateRowId);
    written++;
  }

  return written;
}

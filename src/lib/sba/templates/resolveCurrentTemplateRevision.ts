/**
 * Resolves the CURRENTLY-published PDF for one official SBA/IRS form
 * source page, plus a sha256 of its bytes. Shared by
 * scripts/ingest-sba-templates.ts and templateStalenessChecker.ts so both
 * the one-off ingester and the recurring cron check are asking the exact
 * same question in the exact same way — a checker that resolved things
 * even slightly differently from the ingester could flag false staleness
 * (or worse, false confidence) forever.
 *
 * No "server-only" — plain fetch-based, works from both a Next.js API
 * route and a standalone tsx script, and stays testable under node --test
 * with a stubbed global fetch.
 */

import { createHash } from "node:crypto";

export type ResolvedTemplateRevision = {
  pdfUrl: string;
  revision: string | null;
  sha256: string;
  /**
   * Included so a caller that also needs the bytes (the ingestion script,
   * to write the file + parse AcroForm fields) doesn't have to re-fetch
   * the same PDF a second time just to get them again. The staleness
   * checker ignores this field.
   */
  pdfBytes: Buffer;
};

export async function resolveCurrentTemplateRevision(sourcePageUrl: string): Promise<ResolvedTemplateRevision> {
  const pageRes = await fetch(sourcePageUrl, { redirect: "follow" });
  if (!pageRes.ok) {
    throw new Error(`source page fetch failed: ${pageRes.status} ${pageRes.statusText}`);
  }
  const html = await pageRes.text();

  // sba.gov/irs.gov document pages link the current PDF from that same
  // domain. Do not hardcode a specific file name/revision — parse it off
  // the page every run so a superseded revision is never silently reused.
  //
  // The original script this was extracted from only matched
  // www.sba.gov/sites/*.pdf — which means IRS_4506C (an irs.gov source
  // page) could never have actually resolved, network access aside. Not
  // caught earlier since this codebase has never had working network
  // access to either domain to notice. Broadened to both hosts here.
  const match = html.match(/href="(https:\/\/www\.(?:sba|irs)\.gov\/[^"]+\.pdf)"/i);
  if (!match) {
    throw new Error("could not locate a .pdf link on the source page — page structure may have changed");
  }

  const revisionMatch = html.match(/Revision date:\s*([A-Za-z]+\s+\d{4})/i);
  const pdfUrl = match[1];
  const revision = revisionMatch?.[1]?.trim() ?? null;

  const pdfRes = await fetch(pdfUrl, { redirect: "follow" });
  if (!pdfRes.ok) {
    throw new Error(`pdf fetch failed: ${pdfRes.status} ${pdfRes.statusText}`);
  }
  const bytes = Buffer.from(await pdfRes.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  return { pdfUrl, revision, sha256, pdfBytes: bytes };
}

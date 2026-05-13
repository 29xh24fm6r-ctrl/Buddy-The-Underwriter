/**
 * SPEC-EXTRACT-VALIDATOR-WIRE-1 (rev 2) §5 — one-time validation backfill.
 *
 * For every deal that has tax-return documents, calls the post-extraction
 * IRS identity validator on each doc. The validator self-gates on
 * deals.validation_disabled and isTaxReturnDocument; no need to filter
 * upstream — the script just enumerates candidates and calls.
 *
 * Why this exists: prior to rev 2 of the spec, the validator returned
 * SKIPPED without persisting a row whenever it couldn't resolve a form
 * type. The 19 existing deals (126 tax returns) have no audit rows.
 * Running this once after merge writes the missing rows for those deals;
 * future extractions populate rows directly via finalizeExtractionRun.
 *
 * Idempotent: the validator upserts on (document_id), so re-running
 * overwrites stale rows with fresh ones. Safe to run multiple times.
 *
 * Run:
 *   pnpm tsx --conditions=react-server scripts/backfill-extraction-validation.ts
 *
 * Why `--conditions=react-server`:
 *   The validator imports "server-only" which throws in plain Node runtime.
 *   The react-server condition routes "server-only" to its empty stub.
 *
 * Required env vars:
 *   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE
 *
 * Recommended invocation (capture log for audit):
 *   pnpm tsx --conditions=react-server scripts/backfill-extraction-validation.ts \
 *     2>&1 | tee logs/backfill-validation-$(date +%Y%m%d-%H%M%S).log
 */

import process from "node:process";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runPostExtractionValidation } from "@/lib/extraction/postExtractionValidator";
import { TAX_RETURN_CANONICAL_TYPES } from "@/lib/extraction/resolveIrsFormType";

type DocRow = {
  id: string;
  deal_id: string;
  canonical_type: string | null;
  ai_form_numbers: string[] | null;
  document_type: string | null;
  ai_tax_year: number | null;
  doc_year: number | null;
};

type PerDealSummary = {
  deal_id: string;
  docs_processed: number;
  verified: number;
  partial: number;
  flagged: number;
  blocked: number;
  skipped: number;
};

const CONCURRENCY = 3;

async function main(): Promise<void> {
  const sb = supabaseAdmin();
  const startedAt = Date.now();

  console.log("[backfill-validation] starting…");
  console.log(`[backfill-validation] tax-return canonical types: ${TAX_RETURN_CANONICAL_TYPES.size}`);

  // Find all tax-return documents across all deals
  const { data: docs, error } = await (sb as any)
    .from("deal_documents")
    .select("id, deal_id, canonical_type, ai_form_numbers, document_type, ai_tax_year, doc_year")
    .in("canonical_type", Array.from(TAX_RETURN_CANONICAL_TYPES));

  if (error) {
    console.error("[backfill-validation] failed to fetch documents:", error.message);
    process.exit(1);
  }

  const allDocs = (docs ?? []) as DocRow[];
  console.log(`[backfill-validation] found ${allDocs.length} tax-return documents`);

  if (allDocs.length === 0) {
    console.log("[backfill-validation] nothing to backfill. done.");
    return;
  }

  // Group by deal_id
  const byDeal = new Map<string, DocRow[]>();
  for (const d of allDocs) {
    const arr = byDeal.get(d.deal_id) ?? [];
    arr.push(d);
    byDeal.set(d.deal_id, arr);
  }
  console.log(`[backfill-validation] spanning ${byDeal.size} deal(s)`);

  const perDealSummaries: PerDealSummary[] = [];

  for (const [dealId, dealDocs] of byDeal) {
    const summary: PerDealSummary = {
      deal_id: dealId,
      docs_processed: 0,
      verified: 0,
      partial: 0,
      flagged: 0,
      blocked: 0,
      skipped: 0,
    };

    // Per-deal concurrency limit
    for (let i = 0; i < dealDocs.length; i += CONCURRENCY) {
      const chunk = dealDocs.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (doc) => {
          const taxYear = doc.ai_tax_year ?? doc.doc_year ?? null;
          return runPostExtractionValidation(
            doc.id,
            doc.deal_id,
            {
              canonical_type: doc.canonical_type,
              ai_form_numbers: doc.ai_form_numbers,
              document_type: doc.document_type,
            },
            taxYear,
          );
        }),
      );

      for (const r of results) {
        summary.docs_processed += 1;
        switch (r.status) {
          case "VERIFIED": summary.verified += 1; break;
          case "PARTIAL":  summary.partial += 1; break;
          case "FLAGGED":  summary.flagged += 1; break;
          case "BLOCKED":  summary.blocked += 1; break;
          case "SKIPPED":  summary.skipped += 1; break;
        }
      }
    }

    console.log(`[backfill-validation] deal=${dealId} ${JSON.stringify(summary)}`);
    perDealSummaries.push(summary);
  }

  // Final tally
  const totals = perDealSummaries.reduce(
    (acc, s) => ({
      docs_processed: acc.docs_processed + s.docs_processed,
      verified: acc.verified + s.verified,
      partial: acc.partial + s.partial,
      flagged: acc.flagged + s.flagged,
      blocked: acc.blocked + s.blocked,
      skipped: acc.skipped + s.skipped,
    }),
    { docs_processed: 0, verified: 0, partial: 0, flagged: 0, blocked: 0, skipped: 0 },
  );

  const elapsedMs = Date.now() - startedAt;
  console.log("");
  console.log("[backfill-validation] === SUMMARY ===");
  console.log(`  deals:          ${perDealSummaries.length}`);
  console.log(`  docs processed: ${totals.docs_processed}`);
  console.log(`  verified:       ${totals.verified}`);
  console.log(`  partial:        ${totals.partial}`);
  console.log(`  flagged:        ${totals.flagged}`);
  console.log(`  blocked:        ${totals.blocked}`);
  console.log(`  skipped:        ${totals.skipped}`);
  console.log(`  elapsed:        ${(elapsedMs / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error("[backfill-validation] fatal:", err);
  process.exit(1);
});

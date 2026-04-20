#!/usr/bin/env tsx
/**
 * Phase 84 T-04 — Extraction probe.
 *
 * Invokes extractWithGeminiPrimary directly against a recently-classified
 * document and confirms deal_extraction_runs gets a row with populated
 * metrics. Used to validate the T-04 run-ledger wire-up deterministically
 * (replaces waiting 24h for natural traffic, since gemini_primary_v1 only
 * processes ~1–2 docs/day).
 *
 * Safety bounds:
 *   - Writes to deal_extraction_runs (always) AND deal_financial_facts
 *     (only if the caller of this script separately persists the returned
 *     items; this script does NOT persist facts).
 *   - Refuses to run without --confirm flag.
 *   - Pick a document whose gatekeeper_doc_type the extractor supports
 *     (PERSONAL_TAX_RETURN, BUSINESS_TAX_RETURN, FINANCIAL_STATEMENT,
 *     PERSONAL_FINANCIAL_STATEMENT, BANK_STATEMENT, RENT_ROLL). UNKNOWN
 *     or OTHER classifications will return "unsupported_doc_type" failure.
 *
 * Usage from repo root:
 *   NODE_OPTIONS="--require=./scripts/preload-server-only-shim.cjs" \
 *     npx tsx scripts/phase-84-t04-extraction-probe.ts <document_id> --confirm
 *
 * Env required (loaded from .env.local then .env, Next.js precedence):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - GEMINI_API_KEY
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env") });
loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

import { extractWithGeminiPrimary } from "@/lib/financialSpreads/extractors/gemini/geminiDocumentExtractor";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function main() {
  const docId = process.argv[2];
  const confirmed = process.argv.includes("--confirm");

  if (!docId || !confirmed) {
    console.error("Usage: npx tsx scripts/phase-84-t04-extraction-probe.ts <doc_id> --confirm");
    process.exit(1);
  }

  for (const k of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GEMINI_API_KEY",
  ]) {
    if (!process.env[k]) {
      console.error(`Missing env: ${k}`);
      process.exit(2);
    }
  }

  const sb = supabaseAdmin();
  const { data: doc, error } = await sb
    .from("deal_documents")
    .select("id, deal_id, bank_id, gatekeeper_doc_type, gatekeeper_tax_year")
    .eq("id", docId)
    .single();

  if (error || !doc) {
    console.error("Doc not found:", error?.message);
    process.exit(1);
  }

  const { data: ocrRow } = await sb
    .from("document_ocr_results")
    .select("extracted_text")
    .eq("attachment_id", docId)
    .maybeSingle();

  if (!ocrRow?.extracted_text) {
    console.error(`No OCR text for doc ${docId}; cannot extract.`);
    process.exit(1);
  }

  const baselineCount =
    (
      await sb
        .from("deal_extraction_runs")
        .select("id", { count: "exact", head: true })
    ).count ?? 0;

  console.log(`[probe] baseline deal_extraction_runs count: ${baselineCount}`);
  console.log(
    `[probe] invoking extractWithGeminiPrimary on ${docId} (${doc.gatekeeper_doc_type}, year=${doc.gatekeeper_tax_year})`,
  );

  const start = Date.now();
  try {
    const result = await extractWithGeminiPrimary({
      dealId: String(doc.deal_id),
      bankId: String(doc.bank_id),
      documentId: String(doc.id),
      ocrText: String(ocrRow.extracted_text),
      docType: String(doc.gatekeeper_doc_type),
      docYear: doc.gatekeeper_tax_year ?? null,
    });
    console.log(`[probe] extraction returned in ${Date.now() - start}ms`, {
      ok: result.ok,
      itemCount: result.items.length,
      failureReason: result.failureReason,
      latencyMs: result.latencyMs,
      model: result.model,
      promptVersion: result.promptVersion,
    });
  } catch (err) {
    console.error(`[probe] extraction THREW in ${Date.now() - start}ms:`, err);
  }

  const postCount =
    (
      await sb
        .from("deal_extraction_runs")
        .select("id", { count: "exact", head: true })
    ).count ?? 0;

  console.log(
    `[probe] post deal_extraction_runs count: ${postCount} (delta: +${postCount - baselineCount})`,
  );

  const { data: latest } = await sb
    .from("deal_extraction_runs")
    .select(
      "id, engine_version, structured_engine, structured_model, status, failure_code, output_hash, metrics, cost_usd, input_tokens, output_tokens, created_at, finalized_at",
    )
    .eq("document_id", docId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  console.log(`[probe] latest run row for ${docId}:`, latest);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

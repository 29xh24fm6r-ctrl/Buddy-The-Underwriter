#!/usr/bin/env tsx
/**
 * Phase 84 T-02 — Bulk reclassify of gatekeeper-failed documents.
 *
 * Finds every deal_document that (a) has ever emitted a
 * DOC_GATEKEEPER_CLASSIFY_FAILED event and (b) is currently stamped
 * UNKNOWN / needs_review, then force-reclassifies each via the real
 * production code path (runGatekeeperForDocument). Used to clean up the
 * backlog created by the maxOutputTokens=512 truncation bug fixed in
 * commits a52538fd + 7f260337.
 *
 * Safety bounds:
 *   - Refuses to run without --confirm flag (production blast radius).
 *   - MAX_DOCS cap refuses to run if query returns more than the limit.
 *   - CONCURRENCY=3 matches runGatekeeperBatch convention; don't raise
 *     without coordinating with Gemini rate limits.
 *   - Per-doc failures don't abort the batch — logged and summarized.
 *   - Does not mutate canonical_type, routing_class, or any downstream
 *     facts. Stamps gatekeeper_* fields only (same as normal pipeline).
 *
 * Usage from repo root:
 *   NODE_OPTIONS="--require=./scripts/preload-server-only-shim.cjs" \
 *     npx tsx scripts/phase-84-t02-reclassify-failed-batch.ts --confirm
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

import { runGatekeeperForDocument } from "@/lib/gatekeeper/runGatekeeper";
import { supabaseAdmin } from "@/lib/supabase/admin";

const MAX_DOCS = 150;
const CONCURRENCY = 3;
const DELAY_BETWEEN_MS = 200;
const REQUIRED_FLAG = "--confirm";

type StuckDoc = {
  id: string;
  deal_id: string;
  bank_id: string;
  sha256: string | null;
  storage_path: string | null;
  storage_bucket: string | null;
  mime_type: string | null;
};

async function findStuckDocs(): Promise<StuckDoc[]> {
  const sb = supabaseAdmin();
  // Find distinct document_ids from failed classify events, then
  // filter to those currently stamped UNKNOWN.
  const { data: failedEvents, error: eventsErr } = await sb
    .from("deal_events")
    .select("payload")
    .eq("kind", "DOC_GATEKEEPER_CLASSIFY_FAILED");
  if (eventsErr) throw new Error(`fetch events: ${eventsErr.message}`);

  const failedDocIds = Array.from(
    new Set(
      (failedEvents ?? [])
        .map((r: any) => r?.payload?.input?.document_id)
        .filter((v: any): v is string => typeof v === "string" && v.length > 0),
    ),
  );

  if (failedDocIds.length === 0) return [];

  const { data: docs, error: docsErr } = await sb
    .from("deal_documents")
    .select(
      "id, deal_id, bank_id, sha256, storage_path, storage_bucket, mime_type, " +
        "gatekeeper_doc_type, gatekeeper_needs_review",
    )
    .in("id", failedDocIds);
  if (docsErr) throw new Error(`fetch docs: ${docsErr.message}`);

  return (docs ?? [])
    .filter(
      (d: any) =>
        d.gatekeeper_doc_type === "UNKNOWN" ||
        d.gatekeeper_needs_review === true ||
        d.gatekeeper_doc_type == null,
    )
    .map((d: any) => ({
      id: String(d.id),
      deal_id: String(d.deal_id),
      bank_id: String(d.bank_id),
      sha256: d.sha256 ?? null,
      storage_path: d.storage_path ?? null,
      storage_bucket: d.storage_bucket ?? null,
      mime_type: d.mime_type ?? null,
    }));
}

async function reclassifyOne(doc: StuckDoc, i: number, total: number) {
  const sb = supabaseAdmin();
  const { data: ocrRow } = await sb
    .from("document_ocr_results")
    .select("extracted_text")
    .eq("attachment_id", doc.id)
    .maybeSingle();

  console.log(`[batch] ${i}/${total} attempting ${doc.id} (deal ${doc.deal_id})`);
  try {
    const result = await runGatekeeperForDocument({
      documentId: doc.id,
      dealId: doc.deal_id,
      bankId: doc.bank_id,
      sha256: doc.sha256 ?? null,
      ocrText: (ocrRow as any)?.extracted_text ?? null,
      storageBucket: doc.storage_bucket || "deal-files",
      storagePath: doc.storage_path || "",
      mimeType: doc.mime_type || "application/pdf",
      forceReclassify: true,
    });
    if (result.doc_type === "UNKNOWN" || result.needs_review) {
      console.log(
        `[batch] ${doc.id} FAILED — doc_type=${result.doc_type}, needs_review=${result.needs_review}, reviewReasonCode=${result.reviewReasonCode}, input_path=${result.input_path}`,
      );
      return { doc_id: doc.id, status: "failed" as const, doc_type: result.doc_type };
    }
    console.log(
      `[batch] ${doc.id} → ${result.doc_type} (conf=${result.confidence})`,
    );
    return { doc_id: doc.id, status: "success" as const, doc_type: result.doc_type };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[batch] ${doc.id} THREW — ${msg}`);
    return { doc_id: doc.id, status: "threw" as const, doc_type: null as string | null, error: msg };
  }
}

async function main() {
  if (!process.argv.includes(REQUIRED_FLAG)) {
    console.error(
      `Refusing to run without ${REQUIRED_FLAG}. This script has production blast radius.`,
    );
    process.exit(2);
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

  const stuck = await findStuckDocs();
  console.log(`[batch] found ${stuck.length} stuck docs to reclassify`);
  if (stuck.length === 0) {
    console.log("[batch] nothing to do");
    return;
  }
  if (stuck.length > MAX_DOCS) {
    console.error(
      `[batch] refusing — stuck count ${stuck.length} exceeds MAX_DOCS=${MAX_DOCS}. Re-check findStuckDocs filter or raise the cap deliberately.`,
    );
    process.exit(3);
  }

  const results: Array<{ doc_id: string; status: string; doc_type: string | null; error?: string }> = [];
  for (let i = 0; i < stuck.length; i += CONCURRENCY) {
    const chunk = stuck.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map((doc, j) => reclassifyOne(doc, i + j + 1, stuck.length)),
    );
    results.push(...chunkResults);
    if (i + CONCURRENCY < stuck.length) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MS));
    }
  }

  const byType: Record<string, number> = {};
  let stillUnknown = 0;
  let stillFailed = 0;
  let threw = 0;
  for (const r of results) {
    if (r.status === "threw") {
      threw++;
      continue;
    }
    if (r.status === "failed") {
      stillFailed++;
      if (r.doc_type === "UNKNOWN") stillUnknown++;
      continue;
    }
    byType[r.doc_type ?? "null"] = (byType[r.doc_type ?? "null"] ?? 0) + 1;
  }

  console.log("\n[batch] ─── Summary ───");
  for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}: ${n}`);
  }
  console.log(`  still_UNKNOWN: ${stillUnknown}`);
  console.log(`  still_failed (needs_review): ${stillFailed}`);
  console.log(`  threw: ${threw}`);
  console.log(`  total: ${results.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

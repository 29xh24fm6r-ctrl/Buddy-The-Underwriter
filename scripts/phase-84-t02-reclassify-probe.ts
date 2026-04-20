#!/usr/bin/env tsx
/**
 * Phase 84 T-02 — Single-document reclassify probe.
 *
 * Force-reclassifies one document end-to-end against production Supabase
 * via service-role credentials. Used to validate whether a classifier bug
 * is still active by running the exact production code path
 * (runGatekeeperForDocument → classifyWithGeminiText/Vision → DB write +
 * ledger event) from a local terminal.
 *
 * Safety bounds: writes to production (updates deal_documents,
 * gatekeeper_cache rows on success, emits real ledger events). Default doc
 * ID is the Ellmann PTR used in the original Phase 84 T-02 diagnosis;
 * override via positional arg. Never remove the default lightly — it is
 * load-bearing for future "is the classifier still healthy?" smoke tests.
 *
 * Usage from repo root:
 *   NODE_OPTIONS="--require=./scripts/preload-server-only-shim.cjs" \
 *     npx tsx scripts/phase-84-t02-reclassify-probe.ts [documentId?]
 *
 * The preload shim neutralizes `import "server-only"` guards in the gatekeeper
 * module so the probe can run outside the Next.js server runtime.
 *
 * Env required (loaded from .env.local then .env, Next.js precedence):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - GEMINI_API_KEY
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "path";

// Next.js env precedence: .env.local > .env. Load in reverse order so
// later calls override earlier ones.
loadEnv({ path: resolve(process.cwd(), ".env") });
loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

import { runGatekeeperForDocument } from "@/lib/gatekeeper/runGatekeeper";
import { supabaseAdmin } from "@/lib/supabase/admin";

const DOC_ID = process.argv[2] || "15b77208-ae2c-4c20-8d48-af500dd996dd";

async function main() {
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
    .select(
      "id, deal_id, bank_id, sha256, storage_path, storage_bucket, mime_type",
    )
    .eq("id", DOC_ID)
    .maybeSingle();
  if (error || !doc) {
    console.error("Could not fetch doc:", error);
    process.exit(1);
  }

  const { data: ocrRow } = await sb
    .from("document_ocr_results")
    .select("extracted_text")
    .eq("attachment_id", DOC_ID)
    .maybeSingle();

  const result = await runGatekeeperForDocument({
    documentId: String(doc.id),
    dealId: String(doc.deal_id),
    bankId: String(doc.bank_id),
    sha256: doc.sha256 ?? null,
    ocrText: ocrRow?.extracted_text ?? null,
    storageBucket: doc.storage_bucket || "deal-files",
    storagePath: doc.storage_path || "",
    mimeType: doc.mime_type || "application/pdf",
    forceReclassify: true,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

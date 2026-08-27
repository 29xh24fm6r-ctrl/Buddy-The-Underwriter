import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { gcsBucketNameOrNull, isGcsBucket } from "@/lib/storage/documentBytes";

function withGcsBucket<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env.GCS_BUCKET;
  if (value === undefined) delete process.env.GCS_BUCKET;
  else process.env.GCS_BUCKET = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.GCS_BUCKET;
    else process.env.GCS_BUCKET = previous;
  }
}

test("a document in the GCS uploads bucket routes to GCS", () => {
  withGcsBucket("buddy-the-underwriter-uploads", () => {
    assert.equal(isGcsBucket("buddy-the-underwriter-uploads"), true);
    assert.equal(gcsBucketNameOrNull(), "buddy-the-underwriter-uploads");
  });
});

test("Supabase-era buckets keep routing to Supabase", () => {
  withGcsBucket("buddy-the-underwriter-uploads", () => {
    for (const bucket of ["deal-files", "deal-documents", "borrower_uploads", "bank-forms"]) {
      assert.equal(isGcsBucket(bucket), false, `${bucket} must not route to GCS`);
    }
  });
});

test("with GCS unconfigured every bucket routes to Supabase", () => {
  withGcsBucket(undefined, () => {
    assert.equal(gcsBucketNameOrNull(), null);
    assert.equal(isGcsBucket("buddy-the-underwriter-uploads"), false);
    assert.equal(isGcsBucket("deal-files"), false);
  });
});

test("null/undefined/blank bucket never routes to GCS", () => {
  withGcsBucket("buddy-the-underwriter-uploads", () => {
    assert.equal(isGcsBucket(null), false);
    assert.equal(isGcsBucket(undefined), false);
    assert.equal(isGcsBucket(""), false);
  });
});

/**
 * The regression this module exists to prevent.
 *
 * Uploads moved to GCS while the processing chain kept calling
 * `supabase.storage.from(<document's bucket>).download(...)`. Supabase has no
 * bucket named `buddy-the-underwriter-uploads`, so every download failed and
 * intake degraded to filename-only classification — OCR skipped, quality
 * FAILED_LOW_TEXT, gatekeeper "No OCR text available" — with no user-visible
 * error. These files must read document bytes through the bucket router.
 */
const BUCKET_AWARE_MODULES = [
  "src/lib/artifacts/processArtifact.ts",
  "src/lib/gatekeeper/runGatekeeper.ts",
  "src/lib/extract/router/extractByDocType.ts",
  "src/lib/ocr/runOcrJob.ts",
  "src/lib/storage/adminStorage.ts",
  "src/lib/storage/getSignedPdfUrl.ts",
  "src/lib/intake/segmentation/splitPdfIntoSegments.ts",
  "src/app/api/deals/[dealId]/documents/intel/run/route.ts",
  "src/lib/intel/run-upload-intel.ts",
];

test("document processing never reads bytes straight from Supabase Storage", () => {
  const direct = /storage\s*\n?\s*\.from\([^)]*\)\s*\n?\s*\.(download|createSignedUrl|upload)\(/;

  for (const file of BUCKET_AWARE_MODULES) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    assert.equal(
      direct.test(source),
      false,
      `${file} calls Supabase Storage directly — use @/lib/storage/documentBytes so GCS-stored documents are readable`,
    );
    assert.match(
      source,
      /@\/lib\/storage\/documentBytes|@\/lib\/storage\/adminStorage/,
      `${file} must go through the bucket-aware storage helpers`,
    );
  }
});

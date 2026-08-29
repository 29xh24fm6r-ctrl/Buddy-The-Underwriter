import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  defaultDocumentBucket,
  documentContentIdentity,
  documentUploadBucket,
  gcsBucketNameOrNull,
  isGcsBucket,
  verifyDocumentContentIdentity,
} from "@/lib/storage/documentBytes";

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

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("new documents are written to GCS when DOC_STORE says so", () => {
  withEnv(
    { DOC_STORE: "gcs", GCS_BUCKET: "buddy-the-underwriter-uploads", SUPABASE_UPLOAD_BUCKET: undefined },
    () => {
      assert.equal(documentUploadBucket(), "buddy-the-underwriter-uploads");
    },
  );
});

test("new documents fall back to a real Supabase bucket, never a phantom one", () => {
  withEnv({ DOC_STORE: "", GCS_BUCKET: "buddy-the-underwriter-uploads", SUPABASE_UPLOAD_BUCKET: undefined }, () => {
    assert.equal(documentUploadBucket(), "deal-files");
  });
  withEnv({ DOC_STORE: "gcs", GCS_BUCKET: undefined, SUPABASE_UPLOAD_BUCKET: undefined }, () => {
    // DOC_STORE asks for GCS but no bucket is configured — fall back rather
    // than hand callers an empty bucket name.
    assert.equal(documentUploadBucket(), "deal-files");
  });
  withEnv({ SUPABASE_UPLOAD_BUCKET: "borrower_uploads" }, () => {
    assert.equal(defaultDocumentBucket(), "borrower_uploads");
  });
});

/**
 * `deal-uploads` has never existed in this Supabase project. Six code paths
 * named it anyway: the borrower share-link uploader wrote to it (and so
 * failed 100% of the time with "Bucket not found"), and several read paths
 * fell back to it for rows with no bucket recorded.
 */
test("no code path names the bucket that does not exist", () => {
  const roots = [path.join(process.cwd(), "src", "app"), path.join(process.cwd(), "src", "lib")];
  const offenders: string[] = [];
  const asBucketValue = /(?:bucket\s*[:=]\s*|\.from\(\s*)"deal-uploads"/;

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      if (asBucketValue.test(readFileSync(full, "utf8"))) {
        offenders.push(path.relative(process.cwd(), full));
      }
    }
  };

  for (const root of roots) walk(root);

  assert.deepEqual(
    offenders,
    [],
    `these files name a storage bucket that does not exist — use documentUploadBucket()/defaultDocumentBucket(): ${offenders.join(", ")}`,
  );
});


test("stored document identity is derived from the actual bytes", () => {
  const bytes = new TextEncoder().encode("buddy");
  assert.deepEqual(documentContentIdentity(bytes), {
    sizeBytes: 5,
    sha256: "e2284dc3b5535645288cde2bad818404be728fb8c9f70b055c0b52023b0ff0a0",
  });
});

test("stored document verification accepts the proven size and digest", () => {
  const bytes = new TextEncoder().encode("buddy");
  assert.deepEqual(
    verifyDocumentContentIdentity({
      bytes,
      expectedSizeBytes: 5,
      expectedSha256: "E2284DC3B5535645288CDE2BAD818404BE728FB8C9F70B055C0B52023B0FF0A0",
    }),
    {
      sizeBytes: 5,
      sha256: "e2284dc3b5535645288cde2bad818404be728fb8c9f70b055c0b52023b0ff0a0",
    },
  );
});

test("stored document verification rejects size drift", () => {
  assert.throws(
    () =>
      verifyDocumentContentIdentity({
        bytes: new TextEncoder().encode("buddy"),
        expectedSizeBytes: 6,
      }),
    /storage_content_verification_failed: size_mismatch/,
  );
});

test("stored document verification rejects digest drift", () => {
  assert.throws(
    () =>
      verifyDocumentContentIdentity({
        bytes: new TextEncoder().encode("buddy"),
        expectedSizeBytes: 5,
        expectedSha256: "0".repeat(64),
      }),
    /storage_content_verification_failed: sha256_mismatch/,
  );
});

test("stored document verification rejects malformed digest claims", () => {
  assert.throws(
    () =>
      verifyDocumentContentIdentity({
        bytes: new TextEncoder().encode("buddy"),
        expectedSizeBytes: 5,
        expectedSha256: "not-a-digest",
      }),
    /storage_content_verification_failed: invalid_expected_sha256/,
  );
});

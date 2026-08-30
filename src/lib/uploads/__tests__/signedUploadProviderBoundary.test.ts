import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSignedUploadEvidence } from "@/lib/uploads/signedUploadBoundary";

test("parseSignedUploadEvidence accepts complete upload evidence", () => {
  assert.deepEqual(
    parseSignedUploadEvidence({
      signedUrl: "https://example.supabase.co/storage/v1/upload/sign/deal-files/a.pdf?token=abc",
      token: "abc",
      path: "deals/deal-1/a.pdf",
    }),
    {
      signedUrl: "https://example.supabase.co/storage/v1/upload/sign/deal-files/a.pdf?token=abc",
      token: "abc",
      path: "deals/deal-1/a.pdf",
    },
  );
});

test("parseSignedUploadEvidence rejects download-only and malformed evidence", () => {
  assert.equal(
    parseSignedUploadEvidence({ signedUrl: "https://example.supabase.co/object/sign/a.pdf" }),
    null,
  );
  assert.equal(
    parseSignedUploadEvidence({ signedUrl: "javascript:alert(1)", token: "abc" }),
    null,
  );
  assert.equal(
    parseSignedUploadEvidence({ signedUrl: "https://user:pass@example.com/a", token: "abc" }),
    null,
  );
});

test("parseSignedUploadEvidence enforces bounded provider values", () => {
  assert.equal(
    parseSignedUploadEvidence({
      signedUrl: "https://example.supabase.co/upload",
      token: "x".repeat(4_097),
    }),
    null,
  );
  assert.equal(
    parseSignedUploadEvidence({
      signedUrl: "https://example.supabase.co/upload",
      token: "abc",
      path: "x".repeat(1_025),
    }),
    null,
  );
});

const signSource = readFileSync(
  join(process.cwd(), "src/lib/uploads/sign.ts"),
  "utf8",
);
const dealSource = readFileSync(
  join(process.cwd(), "src/lib/uploads/signDealUpload.ts"),
  "utf8",
);

test("Supabase upload signing never falls back to a download URL", () => {
  assert.match(signSource, /createSignedUploadUrl/);
  assert.doesNotMatch(signSource, /\.createSignedUrl\(/);
  assert.match(signSource, /invalid_signed_upload_evidence/);
});

test("configured GCS signing fails closed without switching providers", () => {
  assert.match(dealSource, /error: "gcs_signing_unavailable"/);
  assert.doesNotMatch(dealSource, /falling back to Supabase/i);
  const gcsBlock = dealSource.slice(
    dealSource.indexOf('if (docStore === "gcs")'),
    dealSource.indexOf('const bucket = process.env.SUPABASE_UPLOAD_BUCKET'),
  );
  assert.match(gcsBlock, /return \{ ok: false, requestId, error: "gcs_signing_unavailable" \}/);
});

test("signing logs retain only safe provider status evidence", () => {
  assert.doesNotMatch(signSource, /stack:\s*error/);
  assert.doesNotMatch(signSource, /error\.message \?\? String/);
  assert.doesNotMatch(dealSource, /gcsErr/);
});

test("file admission requires a positive safe integer and bounded filename", () => {
  assert.match(dealSource, /Number\.isSafeInteger\(sizeBytes\)/);
  assert.match(dealSource, /sizeBytes <= 0/);
  assert.match(dealSource, /sanitizeFilename\(name\)/);
});

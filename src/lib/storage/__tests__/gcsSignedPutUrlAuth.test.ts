import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const signingHelperPath = join(
  process.cwd(),
  "src/lib/storage/gcsSignedPutUrl.ts",
);

const wifSigningCallers = [
  "src/lib/uploads/signDealUpload.ts",
  "src/app/api/deals/[dealId]/files/gcs/sign-upload/route.ts",
  "src/app/api/borrower/portal/[token]/files/sign/route.ts",
] as const;

test("the shared GCS PUT signer uses Buddy's canonical WIF-capable client", () => {
  const source = readFileSync(signingHelperPath, "utf8");

  assert.match(
    source,
    /await getGcsClient\(\)/,
    "Vercel GCS signing must resolve the canonical Workload Identity client",
  );
  assert.doesNotMatch(
    source,
    /new\s+Storage\s*\(/,
    "a bare Storage client bypasses Buddy's Vercel Workload Identity authentication",
  );
});

test("every direct signed-PUT caller stays behind the WIF-capable helper", () => {
  for (const relativePath of wifSigningCallers) {
    const source = readFileSync(join(process.cwd(), relativePath), "utf8");

    assert.match(
      source,
      /createGcsV4SignedPutUrl/,
      `${relativePath} must use the shared signed-PUT helper`,
    );
    assert.doesNotMatch(
      source,
      /new\s+Storage\s*\(/,
      `${relativePath} must not construct an ambient-credential GCS client`,
    );
  }
});

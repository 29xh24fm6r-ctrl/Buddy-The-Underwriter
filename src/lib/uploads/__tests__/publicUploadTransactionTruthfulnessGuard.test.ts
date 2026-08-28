/**
 * Source guards for the public document-link upload transaction.
 *
 * These guards preserve at-most-once single-use semantics and prevent
 * authoritative Supabase failures from being collapsed into ordinary misses.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../../..");
const route = readFileSync(
  join(ROOT, "src/app/api/public/upload/route.ts"),
  "utf8",
);
const recorder = readFileSync(
  join(ROOT, "src/lib/uploads/recordBorrowerUploadAndMaterialize.ts"),
  "utf8",
);
const metadataRoute = readFileSync(
  join(ROOT, "src/app/api/public/upload-link/meta/route.ts"),
  "utf8",
);
const linkRoute = readFileSync(
  join(ROOT, "src/app/api/deals/[dealId]/upload-links/route.ts"),
  "utf8",
);

function occurrences(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

describe("public upload transaction truthfulness", () => {
  test("idempotency read and persistence failures are explicit", () => {
    const readError = route.indexOf("if (prior.error)");
    const cachedResponse = route.indexOf("if (prior.data?.response)");
    assert.ok(readError >= 0, "idempotency lookup errors must be checked");
    assert.ok(
      readError < cachedResponse,
      "idempotency errors must be handled before cached data",
    );
    assert.match(route, /if \(persisted\.error\)/);
    assert.doesNotMatch(route, /\.throwOnError\(\)/);
  });

  test("deal identity and intake phase come from one fail-closed read", () => {
    assert.equal(
      occurrences(route, /\.from\("deals"\)/g),
      1,
      "the route must not perform a second fallible phase lookup",
    );
    assert.match(route, /\.select\("bank_id, intake_phase"\)/);
    assert.match(route, /if \(dealErr\)/);
  });

  test("single-use link is atomically claimed before storage side effects", () => {
    const claimStart = route.indexOf("const claim = await supabaseAdmin()");
    const uploadLoop = route.indexOf("for (const f of files)");
    const storage = route.indexOf("before_storage_upload");
    assert.ok(claimStart >= 0, "single-use claim must exist");
    assert.ok(claimStart < uploadLoop, "claim must happen before file processing");
    assert.ok(claimStart < storage, "claim must happen before storage");

    const claim = route.slice(claimStart, uploadLoop);
    assert.match(claim, /\.update\(\{ used_at: claimedAt \}\)/);
    assert.match(claim, /\.is\("used_at", null\)/);
    assert.match(claim, /\.is\("revoked_at", null\)/);
    assert.match(claim, /\.gt\("expires_at", claimedAt\)/);
    assert.match(claim, /\.select\("id"\)/);
    assert.match(claim, /\.maybeSingle\(\)/);
    assert.match(route, /if \(claim\.error\)/);
    assert.match(route, /if \(!claim\.data\)/);
    assert.equal(
      occurrences(route, /\.update\(\{ used_at:/g),
      1,
      "used_at must not be written again after side effects",
    );
  });

  test("the complete request is validated before the claim", () => {
    const preflight = route.indexOf("for (const file of files)");
    const claim = route.indexOf("const claim = await supabaseAdmin()");
    assert.ok(preflight >= 0 && preflight < claim);
    assert.match(route.slice(preflight, claim), /ALLOWED_MIME_TYPES/);
    assert.match(route.slice(preflight, claim), /MAX_UPLOAD_BYTES/);
  });

  test("primary link lookup outages are not reported as invalid links", () => {
    const outage = route.indexOf("if (linkErr)");
    const missing = route.indexOf("if (!link)");
    assert.ok(outage >= 0 && missing >= 0);
    assert.ok(outage < missing);
    assert.match(route.slice(outage, missing), /status: 503/);
    assert.match(route.slice(missing), /status: 404/);
  });

  test("chaos probes are unique", () => {
    for (const point of [
      "pre_link_lookup",
      "post_link_validation",
      "before_storage_upload",
    ]) {
      assert.equal(
        occurrences(route, new RegExp(`chaosPoint\\(req, "${point}"\\)`, "g")),
        1,
        `${point} must be invoked exactly once`,
      );
    }
  });
});

describe("public upload link lifecycle truthfulness", () => {
  test("metadata outages are not reported as invalid links", () => {
    const outage = metadataRoute.indexOf("if (error)");
    const missing = metadataRoute.indexOf("if (!data)");
    assert.ok(outage >= 0 && missing >= 0);
    assert.ok(outage < missing);
    assert.match(metadataRoute.slice(outage, missing), /status: 503/);
    assert.match(metadataRoute.slice(missing), /status: 404/);
  });

  test("link creation fails closed when deal stage is unavailable", () => {
    const errorCheck = linkRoute.indexOf("if (dealErr)");
    const lifecycleCheck = linkRoute.indexOf(
      "if (!isBorrowerUploadAllowed",
      errorCheck,
    );
    assert.ok(errorCheck >= 0 && lifecycleCheck >= 0);
    assert.ok(
      errorCheck < lifecycleCheck,
      "database errors must be handled before lifecycle authorization",
    );
    assert.match(linkRoute.slice(errorCheck, lifecycleCheck), /status: 503/);
  });
});

describe("canonical borrower upload audit truthfulness", () => {
  test("read failures cannot fall through to insert or repair paths", () => {
    assert.match(recorder, /if \(existing\.error\)/);
    assert.match(recorder, /if \(orphan\.error\)/);
  });

  test("orphan repair requires returned-row proof", () => {
    assert.match(recorder, /const repaired = await sb/);
    assert.match(
      recorder,
      /\.update\(\{ deal_id: args\.dealId \}\)[\s\S]*?\.is\("deal_id", null\)[\s\S]*?\.select\("id"\)[\s\S]*?\.maybeSingle\(\)/,
    );
    assert.match(recorder, /if \(repaired\.error \|\| !repaired\.data\?\.id\)/);
  });
});

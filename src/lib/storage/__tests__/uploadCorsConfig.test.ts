import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { APP_ORIGIN, CLERK_MARKETING_HOSTS } from "@/lib/navigation/clerkHosts";
import {
  UPLOAD_BROWSER_ORIGINS,
  UPLOAD_CORS_METHODS,
  UPLOAD_CORS_RESPONSE_HEADERS,
  buildBucketCorsConfig,
  corsRulesAllowOrigin,
  type BucketCorsRule,
} from "@/lib/storage/uploadCorsConfig";

function readCorsFile(): BucketCorsRule[] {
  const raw = readFileSync(path.join(process.cwd(), "cors.json"), "utf8");
  return JSON.parse(raw) as BucketCorsRule[];
}

/**
 * Guard for the outage that took doc intake down: the bucket allowed only
 * buddysba.com while the app runs on app.buddytheunderwriter.com, so every
 * signed PUT died on a blocked preflight.
 */
test("upload CORS allowlist covers the authenticated app origin", () => {
  assert.ok(
    UPLOAD_BROWSER_ORIGINS.includes(APP_ORIGIN),
    `${APP_ORIGIN} must be allowed to upload — it is where every banker intake runs`,
  );
  assert.ok(corsRulesAllowOrigin(readCorsFile(), APP_ORIGIN));
});

test("every Clerk-known host that serves upload surfaces is allowed", () => {
  const rules = readCorsFile();
  for (const host of CLERK_MARKETING_HOSTS) {
    const origin = `https://${host}`;
    assert.ok(
      corsRulesAllowOrigin(rules, origin),
      `${origin} serves borrower upload links but is missing from cors.json`,
    );
  }
});

test("cors.json is exactly the generated config (run: pnpm gcs:cors:write)", () => {
  assert.deepEqual(readCorsFile(), buildBucketCorsConfig());
});

test("signed-PUT headers and methods are permitted", () => {
  const [rule] = readCorsFile();
  for (const method of UPLOAD_CORS_METHODS) {
    assert.ok(rule.method.includes(method), `missing method ${method}`);
  }
  for (const header of UPLOAD_CORS_RESPONSE_HEADERS) {
    assert.ok(rule.responseHeader.includes(header), `missing header ${header}`);
  }
  // The V4 signature covers this header; without it on the preflight the
  // browser never sends the PUT.
  assert.ok(rule.responseHeader.includes("x-goog-content-length-range"));
});

test("corsRulesAllowOrigin rejects a rule that omits the origin", () => {
  const rules: BucketCorsRule[] = [
    {
      origin: ["https://buddysba.com"],
      method: [...UPLOAD_CORS_METHODS],
      responseHeader: [...UPLOAD_CORS_RESPONSE_HEADERS],
      maxAgeSeconds: 3600,
    },
  ];
  assert.equal(corsRulesAllowOrigin(rules, APP_ORIGIN), false);
  assert.equal(corsRulesAllowOrigin(rules, "https://buddysba.com"), true);
  assert.equal(corsRulesAllowOrigin(rules, "https://buddysba.com/"), true);
});

test("corsRulesAllowOrigin rejects a rule missing the signed length-range header", () => {
  const rules: BucketCorsRule[] = [
    {
      origin: [APP_ORIGIN],
      method: [...UPLOAD_CORS_METHODS],
      responseHeader: ["Content-Type"],
      maxAgeSeconds: 3600,
    },
  ];
  assert.equal(corsRulesAllowOrigin(rules, APP_ORIGIN), false);
});

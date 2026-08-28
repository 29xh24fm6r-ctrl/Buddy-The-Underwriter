/**
 * Source guards for borrower intake persistence truthfulness.
 *
 * The API must never advance the resume pointer unless every canonical fact
 * write and the progress mutation are proven. The client must not expose a
 * fresh-looking chapter when authoritative hydration fails.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../../..");
const route = readFileSync(
  join(ROOT, "src/app/api/borrower/intake/progress/route.ts"),
  "utf8",
);
const client = readFileSync(
  join(ROOT, "src/app/(borrower)/start/StartConciergeClient.tsx"),
  "utf8",
);

function occurrences(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

describe("borrower intake canonical transaction", () => {
  test("concierge creation proves every read and inserted row", () => {
    assert.match(route, /if \(existingResult\.error\)/);
    assert.match(route, /if \(dealResult\.error\)/);
    assert.match(route, /if \(!dealResult\.data\)/);
    assert.match(
      route,
      /\.insert\(\{[\s\S]*?extracted_facts: \{\},[\s\S]*?\.select\("id"\)[\s\S]*?\.maybeSingle\(\)/,
    );
    assert.match(route, /if \(inserted\.error \|\| !inserted\.data\?\.id\)/);
  });

  test("all chapter fact mutations use returned-row proof", () => {
    assert.equal(
      occurrences(route, /loadConciergeFacts\(dealId, sb\)/g),
      4,
    );
    assert.equal(
      occurrences(route, /persistConciergeFacts\(/g) - 1,
      4,
    );
    assert.match(
      route,
      /function persistConciergeFacts[\s\S]*?\.eq\("updated_at", expectedUpdatedAt\)[\s\S]*?\.is\("updated_at", null\)[\s\S]*?\.select\("id, updated_at"\)[\s\S]*?result\.error[\s\S]*?!result\.data\?\.id/,
    );
    assert.match(
      route,
      /const savedDeal = await sb[\s\S]*?\.select\("id"\)[\s\S]*?\.maybeSingle\(\)[\s\S]*?if \(savedDeal\.error \|\| !savedDeal\.data\?\.id\)/,
    );
  });

  test("GET refuses incomplete authoritative hydration", () => {
    const getGuard = route.indexOf(
      "if (completion.degraded.length > 0 || !facts)",
    );
    const getSuccess = route.indexOf("ok: true", getGuard);
    assert.ok(getGuard >= 0 && getSuccess > getGuard);
    assert.match(route.slice(getGuard, getSuccess), /status: 503/);
  });

  test("degraded completion proof blocks resume-pointer advancement", () => {
    const proof = route.indexOf("if (completion.degraded.length > 0)");
    const progressRead = route.indexOf("const { data: existingProgress");
    assert.ok(proof >= 0 && progressRead >= 0 && proof < progressRead);
    assert.match(route.slice(proof, progressRead), /status: 503/);
  });

  test("progress position uses optimistic concurrency and returned-row proof", () => {
    assert.doesNotMatch(route, /\.upsert\(/);
    assert.match(route, /\.eq\("progress_version", prior\.progress_version\)/);
    assert.match(route, /\.is\("progress_version", null\)/);
    assert.match(route, /\.select\("deal_id, progress_version"\)/);
    assert.match(route, /if \(progressWrite\.error\)/);
    assert.match(route, /error: "progress_conflict"/);
  });
});

describe("borrower intake hydration gate", () => {
  test("unavailable authoritative state remains blocked and retryable", () => {
    assert.match(client, /if \(!res\.ok \|\| !json\?\.ok \|\| !json\.progress \|\| !json\.progress\.facts\)/);
    assert.match(client, /setProgressHydrated\(false\)/);
    assert.match(client, /setHydrationError\(/);
    assert.match(client, />\s*Retry loading\s*</);
    assert.doesNotMatch(client, /finally \{[\s\S]*?setProgressHydrated\(true\)/);
  });

  test("hydration rejects a session-to-deal mismatch", () => {
    assert.match(client, /json\.dealId && json\.dealId !== id/);
    assert.match(client, /progress_deal_mismatch/);
  });
});

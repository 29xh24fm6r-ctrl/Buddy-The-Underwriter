import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * SPEC-SPREADS-ROOT-GCF-REDIRECT-OR-BANNER-1 regression guard.
 *
 * The Memo Inputs Fix Now path already deep-links to /spreads/global-cash-flow
 * (SPEC-GCF-FIXPATH-DEEP-LINK-1). This guard covers the OTHER way in: a banker
 * navigating to the generic /deals/[dealId]/spreads page, which opens on the
 * read-only Executive Summary tab. When the live memo-readiness state still has
 * a missing_global_cash_flow blocker, the root page must surface an
 * above-the-fold CTA that deep-links to the Global Cash Flow page.
 */

const root = process.cwd();
const CLIENT = "src/components/deals/spreads/SpreadsPageClient.tsx";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(root, rel), "utf8");
}

test("root spreads page detects the live missing_global_cash_flow blocker", () => {
  const src = read(CLIENT);
  assert.ok(
    /\/api\/deals\/\$\{dealId\}\/memo-inputs/.test(src),
    "must read live memo readiness from the memo-inputs endpoint",
  );
  assert.ok(
    /readiness\?\.blockers/.test(src) || /readiness\.blockers/.test(src),
    "must inspect readiness.blockers",
  );
  assert.ok(
    /"missing_global_cash_flow"/.test(src),
    "must key off the missing_global_cash_flow blocker code",
  );
});

test("banner renders the required CTA copy and deep-links to the GCF page", () => {
  const src = read(CLIENT);
  assert.ok(
    /Global Cash Flow is required for memo readiness/.test(src),
    "must show the required-banner headline",
  );
  assert.ok(
    /Go to Global Cash Flow/.test(src),
    "must offer a 'Go to Global Cash Flow' action",
  );
  assert.ok(
    /href=\{`\/deals\/\$\{dealId\}\/spreads\/global-cash-flow`\}/.test(src),
    "CTA must deep-link to the Global Cash Flow sub-page",
  );
});

test("banner is gated on the blocker and rendered above the report/tab content", () => {
  const src = read(CLIENT);
  assert.ok(/gcfBlocked/.test(src), "banner must be gated on gcfBlocked state");
  // Banner block appears before the Executive Summary panel render in the JSX.
  const bannerIdx = src.indexOf("Global Cash Flow is required for memo readiness");
  const summaryIdx = src.indexOf("<ExecutiveSummaryPanel");
  assert.ok(bannerIdx !== -1 && summaryIdx !== -1, "both banner and summary exist");
  assert.ok(
    bannerIdx < summaryIdx,
    "the GCF banner must render above the Executive Summary content",
  );
});

test("readiness detection is read-only and fails open", () => {
  const src = read(CLIENT);
  // No mutating verbs against readiness/memo-inputs from this client.
  assert.ok(
    !/method:\s*"(POST|PATCH|PUT|DELETE)"[\s\S]{0,160}memo-inputs/.test(src),
    "root page must not mutate memo inputs / readiness",
  );
  assert.ok(
    /fail-open/.test(src),
    "must document fail-open behavior (no banner on fetch error)",
  );
});

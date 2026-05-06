/**
 * DealShell primary action must be readiness-aware.
 *
 * Verifies that DealShell mounts DealShellMemoCta and that the CTA cycles
 * through the three labels: "Complete Memo Inputs" / "Review Credit Memo"
 * / "View Submitted Memo".
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const SHELL = join(REPO_ROOT, "src/app/(app)/deals/[dealId]/DealShell.tsx");
const CTA = join(REPO_ROOT, "src/components/deals/DealShellMemoCta.tsx");

function read(p: string) {
  return readFileSync(p, "utf8");
}

test("[shell-cta-1] DealShell imports and mounts DealShellMemoCta", () => {
  const body = read(SHELL);
  assert.match(body, /import\s+DealShellMemoCta\s+from/);
  assert.match(body, /<DealShellMemoCta/);
});

test("[shell-cta-2] DealShellMemoCta surfaces all three label states", () => {
  const body = read(CTA);
  assert.ok(body.includes("Complete Memo Inputs"));
  assert.ok(body.includes("Review Credit Memo"));
  assert.ok(body.includes("View Submitted Memo"));
});

test("[shell-cta-3] DealShellMemoCta calls /api/deals/[id]/readiness", () => {
  const body = read(CTA);
  assert.match(body, /\/api\/deals\/\$\{dealId\}\/readiness/);
});

test("[shell-cta-4] DealShellMemoCta blocked path links to /memo-inputs", () => {
  const body = read(CTA);
  assert.match(body, /\/deals\/\$\{dealId\}\/memo-inputs/);
});

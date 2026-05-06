/**
 * Memo Ownership Invariant CI Guard
 *
 * Invariant: Buddy assembles, Banker submits.
 *
 * Only ONE caller may write the literal string 'banker_submitted' as a
 * value to credit_memo_snapshots.status — submitCreditMemoToUnderwriting.
 * Every other caller is a violation of the ownership boundary.
 *
 * Tests scan the src/ tree (excluding allowlisted files) for any
 * occurrence of the literal 'banker_submitted' or "banker_submitted".
 * If any unauthorized file references the value, the guard fails.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const SRC_ROOT = join(REPO_ROOT, "src");

// Files that are PERMITTED to reference the 'banker_submitted' literal.
// Adding to this list weakens the ownership boundary — review carefully.
//
// Two flavors of allowed reference:
//   (write) — only submitCreditMemoToUnderwriting.ts may insert the status
//   (read)  — the underwriter loop must read this state to transition it
//             to 'finalized' or 'returned'. Read predicates do not violate
//             the ownership invariant. Guard 4 below CI-locks the
//             "no other writer" rule independently.
const ALLOWLIST: ReadonlySet<string> = new Set([
  // The single authorized writer.
  "src/lib/creditMemo/submission/submitCreditMemoToUnderwriting.ts",
  // Pure types — declares the union, does not write.
  "src/lib/creditMemo/submission/types.ts",
  // Tests for the submission gate are allowed to reference it.
  "src/lib/creditMemo/submission/__tests__/ownershipInvariantGuard.test.ts",
  "src/lib/creditMemo/submission/__tests__/evaluateMemoReadinessContract.test.ts",
  "src/lib/creditMemo/submission/__tests__/computeInputHash.test.ts",
  // Underwriter loop — READS banker_submitted to transition forward.
  // Never writes it as a status. Guarded by [ownership-4] below.
  "src/lib/creditMemo/underwriter/recordUnderwriterDecision.ts",
  "src/lib/creditMemo/underwriter/types.ts",
  "src/app/api/deals/[dealId]/credit-memo/underwriter-decision/route.ts",
  // Underwriter UI surfaces — render the frozen snapshot. Read-only.
  "src/components/creditMemo/SubmittedMemoView.tsx",
  "src/components/creditMemo/UnderwriterDecisionForm.tsx",
  // The credit memo page detects the frozen snapshot to bypass the
  // live builder. Read-only — does not write the status.
  "src/app/(app)/credit-memo/[dealId]/canonical/page.tsx",
  // Intelligence layer — reads frozen snapshots only. Read-only.
  // Guarded structurally by intelligenceGuard.test.ts ([intel-2/3]).
  "src/app/api/deals/[dealId]/credit-memo/intelligence/route.ts",
  "src/lib/creditMemo/intelligence/analyzeUnderwriterDecisions.ts",
  // Unified readiness — reads submitted snapshots to surface the right CTA.
  // Guards: read-only (no .insert/.update with banker_submitted).
  "src/lib/deals/readiness/buildUnifiedDealReadiness.ts",
  "src/lib/deals/readiness/unifyDealReadiness.ts",
  // Memo input redirect guard on the credit-memo page — read-only check
  // for an existing submitted snapshot before deciding whether to redirect.
  "src/app/(app)/deals/[dealId]/credit-memo/page.tsx",
  "src/app/(app)/deals/[dealId]/credit-memo/__tests__/creditMemoRedirectGuard.test.ts",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
]);

function* walkTs(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walkTs(full);
    } else if (
      st.isFile() &&
      (full.endsWith(".ts") || full.endsWith(".tsx"))
    ) {
      yield full;
    }
  }
}

function findOffenders(): Array<{ path: string; line: number; preview: string }> {
  const offenders: Array<{ path: string; line: number; preview: string }> = [];
  for (const path of walkTs(SRC_ROOT)) {
    const rel = relative(REPO_ROOT, path).replace(/\\/g, "/");
    if (ALLOWLIST.has(rel)) continue;

    let body: string;
    try {
      body = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    if (!body.includes("banker_submitted")) continue;

    const lines = body.split(/\r?\n/);
    lines.forEach((ln, i) => {
      if (ln.includes("banker_submitted")) {
        offenders.push({ path: rel, line: i + 1, preview: ln.trim().slice(0, 200) });
      }
    });
  }
  return offenders;
}

// ─── Guard 1: Ownership boundary is intact ──────────────────────────────────

test("[ownership-1] only allowlisted files may reference 'banker_submitted'", () => {
  const offenders = findOffenders();
  if (offenders.length > 0) {
    const detail = offenders
      .map((o) => `  ${o.path}:${o.line}  ${o.preview}`)
      .join("\n");
    assert.fail(
      `Ownership invariant violated. Only submitCreditMemoToUnderwriting.ts may write status='banker_submitted'.\n` +
        `Found ${offenders.length} unauthorized reference(s):\n${detail}\n\n` +
        `If this is a legitimate addition (e.g. underwriter rendering), update ALLOWLIST in this guard.`,
    );
  }
});

// ─── Guard 2: The authorized writer exists and writes the literal ──────────

test("[ownership-2] submitCreditMemoToUnderwriting actually writes the status", () => {
  const path = join(REPO_ROOT, "src/lib/creditMemo/submission/submitCreditMemoToUnderwriting.ts");
  const body = readFileSync(path, "utf8");
  assert.ok(
    body.includes("banker_submitted"),
    "submitCreditMemoToUnderwriting.ts must reference 'banker_submitted' — without it, no submission can be made.",
  );
});

// ─── Guard 3: The status enum is single-source-of-truth ────────────────────

// ─── Guard 4: No other file may *write* banker_submitted as a status ──────
// This is the structural complement to the literal-grep in Guard 1. It
// catches the specific dangerous pattern: object literals where `status`
// is set to "banker_submitted" inside an .insert() or .update() call.

test("[ownership-4] only submitCreditMemoToUnderwriting writes status='banker_submitted'", () => {
  const offenders: Array<{ path: string; line: number; preview: string }> = [];
  // Match an object-literal property write: `status: "banker_submitted"`
  // followed by a comma or closing brace. This is what Supabase
  // `.insert({...})` and `.update({...})` produce. A `|` after the value
  // means a TypeScript union — not a write — and is NOT matched.
  const writeRe = /status\s*:\s*["']banker_submitted["']\s*[,}]/;
  for (const path of walkTs(SRC_ROOT)) {
    const rel = relative(REPO_ROOT, path).replace(/\\/g, "/");
    if (rel.includes("/__tests__/")) continue;
    if (rel === "src/lib/creditMemo/submission/submitCreditMemoToUnderwriting.ts") continue;
    let body: string;
    try {
      body = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const lines = body.split(/\r?\n/);
    lines.forEach((ln, i) => {
      if (writeRe.test(ln)) {
        offenders.push({ path: rel, line: i + 1, preview: ln.trim().slice(0, 200) });
      }
    });
  }
  if (offenders.length > 0) {
    const detail = offenders
      .map((o) => `  ${o.path}:${o.line}  ${o.preview}`)
      .join("\n");
    assert.fail(
      `Ownership invariant violated: status='banker_submitted' written outside the authorized writer.\n${detail}`,
    );
  }
});

test("[ownership-3] status type union is declared exactly once", () => {
  // Skip __tests__ directories — tests are allowed to reference the
  // status literals (e.g. for fixture construction) and may incidentally
  // contain the same lexical pattern as the type union.
  const offenders: Array<{ path: string; line: number }> = [];
  for (const path of walkTs(SRC_ROOT)) {
    const rel = relative(REPO_ROOT, path).replace(/\\/g, "/");
    if (rel.includes("/__tests__/")) continue;
    let body: string;
    try {
      body = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    // Detect any code that looks like it's redefining the lifecycle states.
    // The pattern matches a literal-string union with both 'draft' and
    // 'banker_submitted' on the same line — that's the canonical type
    // definition shape. Only types.ts may declare it.
    const re = /["']draft["'][^;]*?["']banker_submitted["']/;
    const match = re.exec(body);
    if (match && rel !== "src/lib/creditMemo/submission/types.ts") {
      const line = body.slice(0, match.index).split(/\r?\n/).length;
      offenders.push({ path: rel, line });
    }
  }
  if (offenders.length > 0) {
    const detail = offenders.map((o) => `  ${o.path}:${o.line}`).join("\n");
    assert.fail(
      `Lifecycle status union must be declared only in types.ts.\nDuplicate declarations:\n${detail}`,
    );
  }
});

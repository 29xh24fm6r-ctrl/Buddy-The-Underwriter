/**
 * SPEC-CURRENT-STAGE-AUDIT-FIX-2 — dead financial-snapshot table guard.
 *
 * `deal_financial_snapshots` does NOT exist in the database. Six modules (credit-memo input,
 * risk pricing, self-heal, borrower readiness, next-best-action, fact reconciliation) queried it
 * and silently received null on every deal — the persisted snapshot (written to financial_snapshots)
 * was never read back. This guard bans any real query against that table so the bug cannot regress.
 *
 * The ONLY permitted mention is the defensive dual-read in buildCommitteeAnticipation.ts (which
 * tries both table names) and documentation/comments that name the dead table to warn future readers.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

test("no .from('deal_financial_snapshots') query anywhere in src (the table does not exist)", () => {
  let out = "";
  try {
    out = execSync(
      `grep -rnE "from\\\\(\\s*[\\"']deal_financial_snapshots[\\"']" src --include='*.ts' --include='*.tsx' || true`,
      { encoding: "utf8" },
    );
  } catch {
    out = "";
  }

  const offenders = out
    .split("\n")
    .filter((l) => l.trim())
    .filter((l) => !l.includes("__tests__"))
    // buildCommitteeAnticipation intentionally probes BOTH table names in a loop over a string
    // array — that is a defensive read, not a hardcoded query against the dead table.
    .filter((l) => !l.includes("buildCommitteeAnticipation.ts"));

  assert.deepEqual(
    offenders,
    [],
    `Query against nonexistent table deal_financial_snapshots (use financial_snapshots):\n${offenders.join("\n")}`,
  );
});

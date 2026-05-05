/**
 * Snapshot Immutability CI Guard
 *
 * Rule 4: once a credit_memo_snapshots row leaves status='draft', the
 * audit-bearing fields are read-only at the database layer. This is
 * enforced by a Postgres BEFORE UPDATE trigger created in the
 * 20260609000000_credit_memo_submission_lifecycle.sql migration.
 *
 * We can't run the trigger without a live database, but we can CI-lock
 * its presence — the migration must declare the trigger AND the function
 * must enforce all the audit-bearing fields.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
  "20260609000000_credit_memo_submission_lifecycle.sql",
);

const MIGRATION = readFileSync(MIGRATION_PATH, "utf8");

// ─── Guard 1: trigger exists ─────────────────────────────────────────────

test("[immut-1] migration declares the immutability trigger", () => {
  assert.ok(
    MIGRATION.includes("create trigger trg_credit_memo_snapshots_immutability"),
    "trigger trg_credit_memo_snapshots_immutability must be created",
  );
  assert.ok(
    MIGRATION.includes("before update on credit_memo_snapshots"),
    "trigger must run BEFORE UPDATE",
  );
  assert.ok(
    MIGRATION.includes("for each row"),
    "trigger must run FOR EACH ROW",
  );
});

// ─── Guard 2: function exists and is plpgsql ─────────────────────────────

test("[immut-2] enforcement function is declared", () => {
  assert.ok(
    MIGRATION.includes(
      "create or replace function credit_memo_snapshots_enforce_immutability()",
    ),
    "enforcement function must be declared",
  );
  assert.ok(MIGRATION.includes("language plpgsql"));
});

// ─── Guard 3: every audit-bearing field is checked ──────────────────────
// If a new audit-bearing column is added to the schema in the future, the
// trigger must be extended to cover it. This guard fails when any of the
// known audit fields is omitted from the trigger body.

test("[immut-3] trigger checks every audit-bearing field", () => {
  const REQUIRED_FIELDS = [
    "memo_output_json",
    "banker_certification_json",
    "readiness_contract_json",
    "data_sources_json",
    "input_hash",
    "submitted_by",
    "submitted_at",
    "memo_version",
    "deal_id",
  ];
  const missing: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    // Each field must appear in the trigger body inside a "is distinct from"
    // comparison — that's how the trigger detects an attempted change.
    const re = new RegExp(`new\\.${field}\\s+is\\s+distinct\\s+from\\s+old\\.${field}`, "i");
    if (!re.test(MIGRATION)) {
      missing.push(field);
    }
  }
  if (missing.length > 0) {
    assert.fail(
      `Immutability trigger does not cover: ${missing.join(", ")}\n` +
        `Add an "if new.<field> is distinct from old.<field>" check for each.`,
    );
  }
});

// ─── Guard 4: status cannot transition back to draft ────────────────────

test("[immut-4] trigger rejects backwards transition to draft", () => {
  assert.ok(
    /new\.status\s*=\s*'draft'\s+and\s+old\.status\s*<>\s*'draft'/i.test(MIGRATION),
    "trigger must reject status transitioning back to draft",
  );
});

// ─── Guard 5: draft rows are exempt from the trigger ────────────────────

test("[immut-5] trigger allows free updates while status='draft'", () => {
  assert.ok(
    /if\s+old\.status\s*=\s*'draft'\s+then\s*\n?\s*return\s+new/i.test(MIGRATION),
    "trigger must short-circuit when old.status is draft",
  );
});

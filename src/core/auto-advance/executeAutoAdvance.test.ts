import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

test("executeAutoAdvance is server-only", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/auto-advance/executeAutoAdvance.ts"),
    "utf8",
  );
  assert.ok(content.includes('import "server-only"'), "Must import server-only");
});

test("executeAutoAdvance writes audit records", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/auto-advance/executeAutoAdvance.ts"),
    "utf8",
  );
  assert.ok(content.includes("deal_auto_advance_events"), "Must write auto-advance event");
  assert.ok(content.includes("deal_events"), "Must write lifecycle event");
  assert.ok(content.includes("logLedgerEvent"), "Must write ledger event");
  assert.ok(content.includes("deal.auto_advanced"), "Must use auto_advanced event key");
});

test("executeAutoAdvance is idempotent", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/auto-advance/executeAutoAdvance.ts"),
    "utf8",
  );
  assert.ok(content.includes(".select(\"stage\")"), "Must check current stage");
  assert.ok(content.includes("fromStage"), "Must compare from-stage for idempotency");
});

test("executeAutoAdvance updates deals.stage", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/auto-advance/executeAutoAdvance.ts"),
    "utf8",
  );
  assert.ok(
    content.includes("stage: evaluation.toStage"),
    "Must update stage on deals table",
  );
});

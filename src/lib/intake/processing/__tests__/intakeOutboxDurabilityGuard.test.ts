/**
 * CI Guard — Intake Outbox Durability Invariants
 *
 * Ensures the intake→processing outbox architecture remains correct:
 * - Local worker imports processIntakeOutbox directly (no HTTP)
 * - buddy-core-worker excludes intake.process from forwarding
 * - Kick endpoint is outbox-only (never calls runIntakeProcessing directly)
 * - Confirm route uses finalize RPC (not HTTP self-invocation)
 * - Stalled-outbox detection exists and emits the correct event kind
 * - Outbox consumer uses claim_intake_outbox_batch RPC
 * - Pure stall detection constants are bounded
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  OUTBOX_STALL_THRESHOLD_MS,
  OUTBOX_STALL_VERSION,
  isOutboxStalled,
} from "@/lib/intake/processing/detectOutboxStall";

const ROOT = join(__dirname, "../../../../..");

function readSource(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

describe("Intake Outbox Durability CI Guards", () => {
  // ── Guard 1: Local worker exists and imports domain function directly ──
  test("[guard-1] local intake worker imports processIntakeOutbox directly", () => {
    const workerPath = join(ROOT, "scripts/intake-worker.ts");
    assert.ok(existsSync(workerPath), "scripts/intake-worker.ts must exist");

    const src = readFileSync(workerPath, "utf-8");
    assert.ok(
      src.includes('from "@/lib/workers/processIntakeOutbox"'),
      "intake-worker must import processIntakeOutbox from domain code (not HTTP)",
    );
    assert.ok(
      !src.includes("fetch("),
      "intake-worker must NOT use fetch — it calls the domain function directly",
    );
  });

  // ── Guard 2: buddy-core-worker excludes intake.process ──────────────
  test("[guard-2] buddy-core-worker excludes intake.process from forwarding", () => {
    const src = readSource("services/buddy-core-worker/src/index.ts");
    assert.ok(
      src.includes("kind != 'intake.process'"),
      "buddy-core-worker must explicitly exclude intake.process from claim query",
    );
  });

  // ── Guard 3: Kick endpoint is outbox-only ──────────────────────────
  test("[guard-3] kick endpoint never imports runIntakeProcessing", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/processing/kick/route.ts",
    );
    // Must NOT have a static import of runIntakeProcessing (comment references are OK)
    const hasStaticImport = /^import\s+.*runIntakeProcessing.*from/m.test(src);
    assert.ok(
      !hasStaticImport,
      "kick endpoint must NOT import runIntakeProcessing — all processing enters through the outbox",
    );
    // Must NOT have a function call to runIntakeProcessing
    const hasFnCall = /await\s+runIntakeProcessing\s*\(/.test(src);
    assert.ok(
      !hasFnCall,
      "kick endpoint must NOT call runIntakeProcessing() — all processing enters through the outbox",
    );
    // Must use insertOutboxEvent
    assert.ok(
      src.includes("insertOutboxEvent"),
      "kick endpoint must enqueue via insertOutboxEvent",
    );
    // Must use CAS via updateDealIfRunOwner
    assert.ok(
      src.includes("updateDealIfRunOwner"),
      "kick endpoint must use CAS via updateDealIfRunOwner",
    );
  });

  // ── Guard 4: Confirm route uses finalize RPC ──────────────────────
  test("[guard-4] confirm route uses finalize RPC, not HTTP self-invocation", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/confirm/route.ts",
    );
    assert.ok(
      src.includes("finalize_intake_and_enqueue_processing"),
      "confirm route must use the atomic finalize RPC",
    );
    assert.ok(
      !src.includes("runIntakeProcessing"),
      "confirm route must NOT call runIntakeProcessing — processing is decoupled via outbox",
    );
    assert.ok(
      !src.includes("processConfirmedIntake"),
      "confirm route must NOT call processConfirmedIntake — processing is decoupled via outbox",
    );
  });

  // ── Guard 5: Outbox consumer uses claim RPC ──────────────────────
  test("[guard-5] outbox consumer uses claim_intake_outbox_batch RPC", () => {
    const src = readSource("src/lib/workers/processIntakeOutbox.ts");
    assert.ok(
      src.includes("claim_intake_outbox_batch"),
      "outbox consumer must use claim_intake_outbox_batch RPC for atomic claiming",
    );
    assert.ok(
      src.includes("runIntakeProcessing"),
      "outbox consumer must call runIntakeProcessing for each claimed row",
    );
  });

  // ── Guard 6: Stalled-outbox detection exists ──────────────────────
  test("[guard-6] detectOutboxStall module exists and emits correct event kind", () => {
    const emitSrc = readSource(
      "src/lib/intake/processing/emitOutboxStalledEvent.ts",
    );
    assert.ok(
      emitSrc.includes("intake.processing_outbox_stalled"),
      "stall emitter must use event kind 'intake.processing_outbox_stalled'",
    );

    const statusSrc = readSource(
      "src/app/api/deals/[dealId]/intake/processing-status/route.ts",
    );
    assert.ok(
      statusSrc.includes("isOutboxStalled"),
      "processing-status endpoint must call isOutboxStalled for detection",
    );
    assert.ok(
      statusSrc.includes("emitOutboxStalledEventIfNeeded"),
      "processing-status endpoint must call emitOutboxStalledEventIfNeeded",
    );
  });

  // ── Guard 7: Pure stall detection constants are bounded ──────────
  test("[guard-7] outbox stall threshold is between 60s and 300s", () => {
    assert.ok(
      OUTBOX_STALL_THRESHOLD_MS >= 60_000,
      `stall threshold must be >= 60s (got ${OUTBOX_STALL_THRESHOLD_MS}ms)`,
    );
    assert.ok(
      OUTBOX_STALL_THRESHOLD_MS <= 300_000,
      `stall threshold must be <= 300s (got ${OUTBOX_STALL_THRESHOLD_MS}ms)`,
    );
  });

  // ── Guard 8: Pure stall detection logic ──────────────────────────
  test("[guard-8] isOutboxStalled returns correct verdicts", () => {
    const now = Date.now();

    // Not stalled: delivered
    const delivered = isOutboxStalled(
      { id: "a", attempts: 0, delivered_at: now.toString(), dead_lettered_at: null, created_at: new Date(now - 200_000).toISOString() },
      now,
    );
    assert.equal(delivered.stalled, false, "delivered row should not be stalled");

    // Not stalled: has attempts (consumer is working on it)
    const attempted = isOutboxStalled(
      { id: "b", attempts: 1, delivered_at: null, dead_lettered_at: null, created_at: new Date(now - 200_000).toISOString() },
      now,
    );
    assert.equal(attempted.stalled, false, "row with attempts > 0 should not be stalled");

    // Not stalled: too young
    const young = isOutboxStalled(
      { id: "c", attempts: 0, delivered_at: null, dead_lettered_at: null, created_at: new Date(now - 30_000).toISOString() },
      now,
    );
    assert.equal(young.stalled, false, "young row should not be stalled");

    // STALLED: old, no attempts, not delivered
    const stalled = isOutboxStalled(
      { id: "d", attempts: 0, delivered_at: null, dead_lettered_at: null, created_at: new Date(now - 200_000).toISOString() },
      now,
    );
    assert.equal(stalled.stalled, true, "old undelivered row with 0 attempts must be stalled");
    if (stalled.stalled) {
      assert.equal(stalled.outbox_id, "d");
      assert.ok(stalled.age_seconds >= 199, `age should be ~200s, got ${stalled.age_seconds}`);
    }
  });

  // ── Guard 9: Stall version is set ──────────────────────────────
  test("[guard-9] OUTBOX_STALL_VERSION is set", () => {
    assert.ok(
      OUTBOX_STALL_VERSION.startsWith("outbox_stall_"),
      `OUTBOX_STALL_VERSION must start with 'outbox_stall_' (got '${OUTBOX_STALL_VERSION}')`,
    );
  });

  // ── Guard 10: npm run worker:intake script exists ─────────────────
  test("[guard-10] package.json has worker:intake script", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
    assert.ok(
      pkg.scripts?.["worker:intake"],
      "package.json must have a 'worker:intake' script",
    );
    const script = pkg.scripts["worker:intake"];
    assert.ok(
      script.includes("intake-worker"),
      "worker:intake script must reference intake-worker",
    );
    assert.ok(
      script.includes("--conditions react-server"),
      "worker:intake must use --conditions react-server to resolve server-only",
    );
  });

  // ── Guard 11: Kick endpoint comment documents the NEVER rule ──────
  test("[guard-11] kick endpoint comment documents 'NEVER calls runIntakeProcessing'", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/processing/kick/route.ts",
    );
    assert.ok(
      src.includes("NEVER calls runIntakeProcessing"),
      "kick endpoint JSDoc must document the 'NEVER calls runIntakeProcessing' invariant",
    );
  });

  // ── Guard 12: /api/workers/ excluded from Clerk proxy matcher ──────
  test("[guard-12] proxy matcher excludes /api/workers/ from Clerk middleware", () => {
    const src = readSource("src/proxy.ts");
    // The matcher pattern is a regex string inside the config.matcher array.
    // Match across multiple lines (comments may separate matcher and the pattern).
    const matcherMatch = src.match(/matcher:\s*\[[\s\S]*?"(\/\((?:[^"]+))"[\s\S]*?\]/);
    assert.ok(matcherMatch, "proxy.ts must export a config.matcher array with a regex pattern");

    const pattern = matcherMatch![1];

    // The negative lookahead must include api/workers/
    assert.ok(
      pattern.includes("api/workers/"),
      `proxy matcher pattern must exclude api/workers/ (got: ${pattern})`,
    );
  });

  // ── Guard 13: Recovery route exists and uses correct imports ──────
  test("[guard-13] intake-recovery route uses insertOutboxEvent and hasValidWorkerSecret", () => {
    const src = readSource("src/app/api/workers/intake-recovery/route.ts");
    assert.ok(
      src.includes("hasValidWorkerSecret"),
      "recovery route must authenticate via hasValidWorkerSecret",
    );
    assert.ok(
      src.includes("recoverStuckIntakeDeals"),
      "recovery route must import recoverStuckIntakeDeals domain function",
    );
  });

  // ── Guard 14: Recovery route NEVER imports processing functions ────
  test("[guard-14] intake-recovery NEVER imports runIntakeProcessing or processConfirmedIntake", () => {
    const routeSrc = readSource("src/app/api/workers/intake-recovery/route.ts");
    const domainSrc = readSource("src/lib/workers/recoverStuckIntakeDeals.ts");

    for (const [label, src] of [["route", routeSrc], ["domain", domainSrc]] as const) {
      const hasRunImport = /^import\s+.*runIntakeProcessing.*from/m.test(src);
      assert.ok(
        !hasRunImport,
        `recovery ${label} must NOT import runIntakeProcessing — recovery is outbox-only`,
      );
      const hasProcessImport = /^import\s+.*processConfirmedIntake.*from/m.test(src);
      assert.ok(
        !hasProcessImport,
        `recovery ${label} must NOT import processConfirmedIntake — recovery is outbox-only`,
      );
    }

    // Domain must use insertOutboxEvent
    assert.ok(
      domainSrc.includes("insertOutboxEvent"),
      "recovery domain must enqueue via insertOutboxEvent",
    );
  });

  // ── Guard 15: vercel.json includes intake-recovery cron entry ──────
  test("[guard-15] vercel.json has intake-recovery cron entry", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf-8"));
    assert.ok(Array.isArray(pkg.crons), "vercel.json must have a crons array");

    const entry = pkg.crons.find(
      (c: any) => typeof c.path === "string" && c.path.includes("/api/workers/intake-recovery"),
    );
    assert.ok(entry, "vercel.json must have a cron entry for /api/workers/intake-recovery");
    assert.ok(
      entry.schedule.includes("*/3"),
      `recovery cron should run every 3 minutes (got: ${entry.schedule})`,
    );
  });
});

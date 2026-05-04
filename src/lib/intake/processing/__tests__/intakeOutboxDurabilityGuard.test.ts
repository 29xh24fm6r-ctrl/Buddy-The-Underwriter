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
      { id: "a", attempts: 0, claim_owner: null, claimed_at: null, delivered_at: now.toString(), dead_lettered_at: null, created_at: new Date(now - 200_000).toISOString() },
      now,
    );
    assert.equal(delivered.stalled, false, "delivered row should not be stalled");

    // Not stalled: has attempts (consumer is working on it)
    const attempted = isOutboxStalled(
      { id: "b", attempts: 1, claim_owner: null, claimed_at: null, delivered_at: null, dead_lettered_at: null, created_at: new Date(now - 200_000).toISOString() },
      now,
    );
    assert.equal(attempted.stalled, false, "row with attempts > 0 should not be stalled");

    // Not stalled: too young
    const young = isOutboxStalled(
      { id: "c", attempts: 0, claim_owner: null, claimed_at: null, delivered_at: null, dead_lettered_at: null, created_at: new Date(now - 30_000).toISOString() },
      now,
    );
    assert.equal(young.stalled, false, "young row should not be stalled");

    // Not stalled: claimed within TTL (4 min old claim, TTL=5 min)
    const inFlight = isOutboxStalled(
      { id: "e", attempts: 0, claim_owner: "vercel-intake-123", claimed_at: new Date(now - 240_000).toISOString(), delivered_at: null, dead_lettered_at: null, created_at: new Date(now - 250_000).toISOString() },
      now,
    );
    assert.equal(inFlight.stalled, false, "recently claimed row within TTL must not be stalled");

    // STALLED: old, no attempts, not delivered, never claimed
    const stalled = isOutboxStalled(
      { id: "d", attempts: 0, claim_owner: null, claimed_at: null, delivered_at: null, dead_lettered_at: null, created_at: new Date(now - 200_000).toISOString() },
      now,
    );
    assert.equal(stalled.stalled, true, "old undelivered row with 0 attempts must be stalled");
    if (stalled.stalled) {
      assert.equal(stalled.outbox_id, "d");
      assert.equal(stalled.reason, "never_claimed_timeout", "never-claimed row must use never_claimed_timeout reason");
      assert.ok(stalled.age_seconds >= 199, `age should be ~200s, got ${stalled.age_seconds}`);
    }

    // STALLED: stale claim — claimed but TTL expired (6 min old claim)
    const staleClaim = isOutboxStalled(
      { id: "f", attempts: 0, claim_owner: "vercel-intake-999", claimed_at: new Date(now - 360_000).toISOString(), delivered_at: null, dead_lettered_at: null, created_at: new Date(now - 370_000).toISOString() },
      now,
    );
    assert.equal(staleClaim.stalled, true, "expired-claim row with 0 attempts must be stalled");
    if (staleClaim.stalled) {
      assert.equal(staleClaim.reason, "stale_claim_expired", "expired-claim row must use stale_claim_expired reason");
      assert.equal(staleClaim.claim_owner, "vercel-intake-999");
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
    // Frequency was tightened from */3 to */10 by the worker-hardening patch:
    // recovery is best-effort backfill, not the hot path; the outbox path
    // covers stuck rows on its own */5 cadence.
    assert.ok(
      entry.schedule.includes("*/10"),
      `recovery cron should run every 10 minutes (got: ${entry.schedule})`,
    );
  });

  // ── Guard 23: per-doc confirm route syncs document_type when canonical_type corrected ──
  test("[guard-23] per-doc confirm route auto-syncs document_type when canonical_type is corrected", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts",
    );
    assert.ok(
      src.includes("body.canonical_type"),
      "Guard 23a: route must reference body.canonical_type",
    );
    assert.ok(
      src.includes("patch.document_type"),
      "Guard 23b: route must set patch.document_type to sync with canonical_type",
    );
    assert.ok(
      src.includes("body.document_type === undefined"),
      "Guard 23c: route must only auto-sync when document_type is not explicitly provided — " +
      "regression guard: intake doc confirm must sync document_type when canonical_type is corrected",
    );
  });

  // ── Guard 19: per-doc confirm route emits checklist.reconciled telemetry ──
  test("[guard-19] per-doc confirm route emits checklist.reconciled (writeEvent or logLedgerEvent)", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts",
    );
    const hasWriteEvent = src.includes('"checklist.reconciled"');
    const hasLedger = src.includes('"deal.checklist.reconciled"');
    assert.ok(
      hasWriteEvent || hasLedger,
      "Guard 19: per-doc confirm route must emit checklist.reconciled telemetry so reconciliation is observable in prod",
    );
  });

  // ── Guard 20: per-doc confirm route emits Pulse checklist_reconciled event ──
  test("[guard-20] per-doc confirm route emits Pulse checklist_reconciled event", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts",
    );
    assert.ok(
      src.includes("checklist_reconciled"),
      "Guard 20: per-doc confirm route must void emitPipelineEvent with kind checklist_reconciled",
    );
  });

  // ── Guard 21: intake confirm route emits checklist.reconciled telemetry ──
  test("[guard-21] intake confirm route emits checklist.reconciled (writeEvent or logLedgerEvent)", () => {
    const src = readSource("src/app/api/deals/[dealId]/intake/confirm/route.ts");
    const hasWriteEvent = src.includes('"checklist.reconciled"');
    const hasLedger = src.includes('"deal.checklist.reconciled"');
    assert.ok(
      hasWriteEvent || hasLedger,
      "Guard 21: intake confirm route must emit checklist.reconciled telemetry so reconciliation is observable in prod",
    );
  });

  // ── Guard 22: intake confirm route emits Pulse checklist_reconciled event ──
  test("[guard-22] intake confirm route emits Pulse checklist_reconciled event", () => {
    const src = readSource("src/app/api/deals/[dealId]/intake/confirm/route.ts");
    assert.ok(
      src.includes("checklist_reconciled"),
      "Guard 22: intake confirm route must void emitPipelineEvent with kind checklist_reconciled",
    );
  });

  // ── Guard 17: per-doc confirm route must call reconcileChecklistForDeal ──
  test("[guard-17] per-doc confirm route calls reconcileChecklistForDeal", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts",
    );
    assert.ok(
      src.includes("reconcileChecklistForDeal"),
      "Guard 17: per-doc confirm route must call reconcileChecklistForDeal so manual corrections immediately update deal_checklist_items",
    );
  });

  // ── Guard 18: intake confirm route must call reconcileChecklistForDeal ──
  test("[guard-18] intake confirm route calls reconcileChecklistForDeal", () => {
    const src = readSource("src/app/api/deals/[dealId]/intake/confirm/route.ts");
    assert.ok(
      src.includes("reconcileChecklistForDeal"),
      "Guard 18: intake confirm route must call reconcileChecklistForDeal so deal_checklist_items is accurate before deal enters cockpit",
    );
  });

  // ── Guard 16: claimed (in-flight) rows within TTL must never be reported as stalled ──
  test("[guard-16] isOutboxStalled returns false for a claimed in-flight row within TTL", () => {
    const now = Date.now();
    const row = {
      id: "test-in-flight",
      attempts: 0,
      claim_owner: "vercel-intake-test",
      claimed_at: new Date(now - 60_000).toISOString(), // claimed 1 min ago — well within 5 min TTL
      delivered_at: null,
      dead_lettered_at: null,
      created_at: new Date(now - 70_000).toISOString(),
    };
    const verdict = isOutboxStalled(row, now);
    assert.strictEqual(
      verdict.stalled,
      false,
      "Guard 16: a claimed row within claim TTL must never be reported as stalled",
    );
  });

  // ── Guard 24: vercel.json must have intake-outbox cron entry ──────────
  test("[guard-24] vercel.json has intake-outbox cron entry", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf-8"));
    assert.ok(Array.isArray(pkg.crons), "vercel.json must have a crons array");
    const entry = pkg.crons.find(
      (c: any) => typeof c.path === "string" && c.path.includes("/api/workers/intake-outbox"),
    );
    assert.ok(
      entry,
      "Guard 24: vercel.json must have a cron entry for /api/workers/intake-outbox — deleting it silently kills intake processing",
    );
    assert.ok(
      typeof entry.schedule === "string" && entry.schedule.length > 0,
      "Guard 24: intake-outbox cron entry must have a non-empty schedule",
    );
  });

  // ── Guard 25: intake-outbox route must authenticate + log startup ──────
  test("[guard-25] intake-outbox route uses hasValidWorkerSecret and emits startup log", () => {
    const src = readSource("src/app/api/workers/intake-outbox/route.ts");
    assert.ok(
      src.includes("hasValidWorkerSecret"),
      "Guard 25a: intake-outbox route must authenticate via hasValidWorkerSecret",
    );
    assert.ok(
      src.includes("cron_invocation_seen"),
      "Guard 25b: intake-outbox route must emit a 'cron_invocation_seen' startup log token for cron audit trail",
    );
  });

  // ── Guard 26: manual correction route must not accept checklist_key ──
  test("[guard-26] checklist-key route BodySchema must not accept checklist_key from client", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/documents/[attachmentId]/checklist-key/route.ts",
    );
    // BodySchema must NOT have a checklist_key field — it is derived internally
    assert.ok(
      !src.includes("checklist_key: z."),
      "Guard 26a: BodySchema must NOT accept checklist_key from client input — " +
      "checklist_key is derived from canonical_type + tax_year via resolveChecklistKey()",
    );
    // BodySchema MUST accept canonical_type and derive checklist_key internally
    assert.ok(
      src.includes("canonical_type"),
      "Guard 26b: BodySchema must accept canonical_type as the client-supplied input",
    );
    assert.ok(
      src.includes("resolveChecklistKey"),
      "Guard 26c: route must derive checklist_key via resolveChecklistKey() — never from client input",
    );
  });

  // ── Guard 28: tryFinalizeSpreadRun drives deal_spread_runs to terminal state ──
  test("[guard-28] tryFinalizeSpreadRun correctly transitions deal_spread_runs to failed/succeeded", () => {
    const src = readSource("src/lib/jobs/processors/spreadsProcessor.ts");
    // Function must exist
    assert.ok(
      src.includes("tryFinalizeSpreadRun"),
      "Guard 28a: spreadsProcessor must define tryFinalizeSpreadRun",
    );
    // Must count failed jobs to determine final status
    assert.ok(
      src.includes("failedCount"),
      "Guard 28b: tryFinalizeSpreadRun must count failed sibling jobs to determine outcome",
    );
    // Must use both terminal statuses
    assert.ok(
      src.includes('"failed"') && src.includes('"succeeded"'),
      "Guard 28c: tryFinalizeSpreadRun must produce both 'failed' and 'succeeded' terminal statuses",
    );
    // Must only update rows currently in non-terminal states (safe CAS)
    assert.ok(
      src.includes('"queued", "running"') || src.includes('"queued","running"') ||
      src.includes(".in(\"status\", [\"queued\", \"running\"])"),
      "Guard 28d: tryFinalizeSpreadRun must only overwrite queued/running rows (idempotent CAS)",
    );
    // Must wait for all siblings to be terminal before finalizing
    assert.ok(
      src.includes("pendingCount") && src.includes("QUEUED") && src.includes("RUNNING"),
      "Guard 28e: tryFinalizeSpreadRun must gate on pending siblings still in QUEUED/RUNNING state",
    );
  });

  // ── Guard 30: no duplicate checklist mapping tables outside docTyping/ ──
  test("[guard-30] no file outside resolveChecklistKey.ts defines canonical_type→checklist_key mapping", () => {
    // The canonical_type → checklist_key mapping MUST live exclusively in
    // src/lib/docTyping/resolveChecklistKey.ts. Any other file that redefines
    // the mapping (even partially) introduces drift risk.
    //
    // Detection: `return "PFS_CURRENT"` is the sentinel — it only makes sense
    // as a mapped return value in resolveChecklistKey. Any other occurrence
    // indicates a duplicate mapping table has been introduced.
    const ALLOWED = ["src/lib/docTyping/resolveChecklistKey.ts"];

    const { execSync } = require("child_process");
    let hits: string[] = [];
    try {
      // rg returns lines like "path:lineNo:content" — we only need paths
      const raw = execSync(
        'rg -l --glob "!*.test.*" --glob "!*.spec.*" "return .PFS_CURRENT." src/',
        { cwd: ROOT, encoding: "utf-8" },
      ).trim();
      hits = raw ? raw.split("\n").map((l: string) => l.trim()).filter(Boolean) : [];
    } catch {
      hits = [];
    }

    // Normalize paths to be relative to ROOT for comparison
    const violations = hits.filter((hit: string) => {
      const rel = hit.replace(ROOT + "/", "").replace(/\\/g, "/");
      return !ALLOWED.some((allowed) => rel.endsWith(allowed) || rel === allowed);
    });

    assert.equal(
      violations.length,
      0,
      `Guard 30: Found ${violations.length} file(s) outside the allowlist containing 'return "PFS_CURRENT"' — ` +
      "all canonical_type→checklist_key mappings must live in resolveChecklistKey.ts.\n" +
      `Violations:\n${violations.join("\n")}`,
    );
  });

  // ── Guard 31: no duplicate FIN_STMT_BS_YTD mapping outside resolveChecklistKey ──
  test("[guard-31] no file outside resolveChecklistKey.ts returns FIN_STMT_BS_YTD as a mapping", () => {
    // The canonical_type → checklist_key mapping for BALANCE_SHEET → FIN_STMT_BS_YTD
    // must live exclusively in resolveChecklistKey.ts. Legacy filename-matching and
    // classification files may reference the constant but MUST NOT define a new
    // canonical_type → key mapping. Detection sentinel: `return "FIN_STMT_BS_YTD"` or
    // `return ["FIN_STMT_BS_YTD"]` as a mapped return value.
    const ALLOWED = [
      "src/lib/docTyping/resolveChecklistKey.ts",
      // Legacy filename matcher returns array of candidate keys — not a canonical mapping
      "src/lib/deals/autoMatchChecklistFromFilename.ts",
      // Legacy classifier returns candidate arrays — predates resolveChecklistKey
      "src/lib/documents/classify.ts",
    ];

    const { execSync } = require("child_process");
    let hits: string[] = [];
    try {
      const raw = execSync(
        'rg -l --glob "!*.test.*" --glob "!*.spec.*" "return.*FIN_STMT_BS_YTD" src/',
        { cwd: ROOT, encoding: "utf-8" },
      ).trim();
      hits = raw ? raw.split("\n").map((l: string) => l.trim()).filter(Boolean) : [];
    } catch {
      hits = [];
    }

    const violations = hits.filter((hit: string) => {
      const rel = hit.replace(ROOT + "/", "").replace(/\\/g, "/");
      return !ALLOWED.some((allowed) => rel.endsWith(allowed) || rel === allowed);
    });

    assert.equal(
      violations.length,
      0,
      `Guard 31: Found ${violations.length} file(s) outside the allowlist containing 'return...FIN_STMT_BS_YTD' — ` +
      "all canonical_type→checklist_key mappings must live in resolveChecklistKey.ts.\n" +
      `Violations:\n${violations.join("\n")}`,
    );
  });

  // ── Guard 32: no duplicate dynamic IRS_PERSONAL_/IRS_BUSINESS_ key generation ──
  test("[guard-32] no file outside the allowlist produces dynamic IRS_PERSONAL_/IRS_BUSINESS_ checklist keys", () => {
    // Dynamic year-based checklist key generation (e.g. `IRS_BUSINESS_${taxYear}`)
    // must be tightly controlled. Only resolveChecklistKey.ts (authoritative) and
    // classifyDocument.ts (classification pipeline) may produce these.
    const ALLOWED = [
      "src/lib/docTyping/resolveChecklistKey.ts",
      // Classification pipeline produces candidate key arrays — legitimate use
      "src/lib/artifacts/classifyDocument.ts",
    ];

    const { execSync } = require("child_process");
    let hits: string[] = [];
    try {
      const raw = execSync(
        'rg -l --glob "!*.test.*" --glob "!*.spec.*" "IRS_(PERSONAL|BUSINESS)_\\$\\{" src/',
        { cwd: ROOT, encoding: "utf-8" },
      ).trim();
      hits = raw ? raw.split("\n").map((l: string) => l.trim()).filter(Boolean) : [];
    } catch {
      hits = [];
    }

    const violations = hits.filter((hit: string) => {
      const rel = hit.replace(ROOT + "/", "").replace(/\\/g, "/");
      return !ALLOWED.some((allowed) => rel.endsWith(allowed) || rel === allowed);
    });

    assert.equal(
      violations.length,
      0,
      `Guard 32: Found ${violations.length} file(s) outside the allowlist producing dynamic IRS_PERSONAL_/IRS_BUSINESS_ keys — ` +
      "dynamic checklist key generation must be limited to resolveChecklistKey.ts and classifyDocument.ts.\n" +
      `Violations:\n${violations.join("\n")}`,
    );
  });

  // ── Guard 29: intake-outbox cron schedule fires at least every 5 minutes ──
  test("[guard-29] vercel.json intake-outbox cron schedule fires every 5 minutes or sooner", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf-8"));
    assert.ok(Array.isArray(pkg.crons), "vercel.json must have a crons array");

    const entry = pkg.crons.find(
      (c: any) => typeof c.path === "string" && c.path.includes("/api/workers/intake-outbox"),
    );
    assert.ok(entry, "Guard 29: vercel.json must have a cron entry for /api/workers/intake-outbox");

    const schedule: string = entry.schedule ?? "";
    // After the worker-hardening patch the cadence is */5. Accept anything
    // tighter (every minute, every 2 min, ...) but reject longer intervals
    // (every 10 min, hourly).
    const ALLOWED = new Set([
      "* * * * *",
      "*/1 * * * *",
      "*/2 * * * *",
      "*/3 * * * *",
      "*/4 * * * *",
      "*/5 * * * *",
    ]);
    assert.ok(
      ALLOWED.has(schedule),
      `Guard 29: intake-outbox cron must fire every 5 minutes or sooner (got: "${schedule}") — ` +
      "a longer interval means unclaimed outbox rows can sit too long before pickup",
    );
  });
});

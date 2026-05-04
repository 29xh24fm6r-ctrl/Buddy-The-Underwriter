import test from "node:test";
import assert from "node:assert/strict";

// ─── Source-level structural tests ──────────────────────────────────────────

test("forwarder core: source exports forwardLedgerBatch", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");
  assert.ok(
    source.includes("export async function forwardLedgerBatch"),
    "Must export forwardLedgerBatch",
  );
});

test("forwarder core: uses claim-based concurrency", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  assert.ok(
    source.includes("pulse_forward_claimed_at"),
    "Must reference pulse_forward_claimed_at column",
  );
  assert.ok(
    source.includes("pulse_forward_claim_id"),
    "Must reference pulse_forward_claim_id column",
  );
  assert.ok(
    source.includes("randomUUID"),
    "Must generate a claim ID with randomUUID",
  );
});

test("forwarder core: implements deadletter after MAX_ATTEMPTS", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  assert.ok(
    source.includes("MAX_ATTEMPTS"),
    "Must define MAX_ATTEMPTS constant",
  );
  assert.ok(
    source.includes("pulse_forward_deadletter_at"),
    "Must set deadletter timestamp on exhausted rows",
  );
});

test("forwarder core: reclaims stale claims", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  assert.ok(
    source.includes("CLAIM_TTL"),
    "Must define claim TTL",
  );
  assert.ok(
    source.includes("staleThreshold"),
    "Must compute stale threshold for claim recovery",
  );
});

test("forwarder core: kill switch returns telemetry_disabled", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  assert.ok(
    source.includes('"telemetry_disabled"'),
    "Must return telemetry_disabled when kill switch is off",
  );
});

test("forwarder core: clears claim fields on success", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  // After successful forward, claimed_at and claim_id must be cleared
  assert.ok(
    source.includes("pulse_forward_claimed_at: null"),
    "Must clear claimed_at on success",
  );
  assert.ok(
    source.includes("pulse_forward_claim_id: null"),
    "Must clear claim_id on success",
  );
});

// The forwarder was intentionally migrated from HMAC (`x-pulse-signature`) to
// Bearer auth in commit 881ace13 ("fix: Align Pulse forwarder with ingest API
// contract"). The endpoint it calls (PULSE_BUDDY_INGEST_URL) accepts a Bearer
// token. HMAC remains the auth scheme on /api/pulse/ingest for observer
// events — see services/pulse-mcp/src/routes/ingestBuddy.ts and the doc note
// at the top of forwardLedgerCore.ts.
test("forwarder core: uses Bearer auth with PULSE_INGEST_TOKEN", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  assert.ok(
    source.includes("PULSE_INGEST_TOKEN"),
    "Must read PULSE_INGEST_TOKEN from env",
  );
  assert.ok(
    /Authorization["'`\s]*:\s*[`"']Bearer\s/i.test(source),
    "Must send Authorization: Bearer header",
  );
});

test("forwarder core: does NOT use HMAC signing (deprecated path)", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  assert.ok(
    !source.includes("x-pulse-signature"),
    "Forwarder must not send x-pulse-signature (Bearer-only since 881ace13)",
  );
  assert.ok(
    !source.includes("createHmac"),
    "Forwarder must not call createHmac (Bearer-only since 881ace13)",
  );
});

test("forwarder core: 2-second timeout on ingest", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  assert.ok(
    source.includes("2000") || source.includes("INGEST_TIMEOUT_MS"),
    "Must enforce 2s timeout on ingest fetch",
  );
  assert.ok(
    source.includes("AbortSignal.timeout"),
    "Must use AbortSignal.timeout",
  );
});

test("forwarder core: never throws", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  // The function should catch errors, not let them propagate
  assert.ok(
    source.includes("catch"),
    "Must have try/catch blocks to prevent throwing",
  );
});

test("forwarder core: returns ForwardResult with required fields", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  assert.ok(source.includes("claimId"), "Result must include claimId");
  assert.ok(source.includes("attempted"), "Result must include attempted");
  assert.ok(source.includes("forwarded"), "Result must include forwarded");
  assert.ok(source.includes("failed"), "Result must include failed count");
  assert.ok(source.includes("deadlettered"), "Result must include deadlettered count");
});

// ─── Route auth structural tests ────────────────────────────────────────────

test("forward-ledger route: Bearer-only auth, no WORKER_SECRET", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/app/api/pulse/forward-ledger/route.ts", "utf-8");

  assert.ok(
    source.includes("PULSE_FORWARDER_TOKEN"),
    "Must check PULSE_FORWARDER_TOKEN",
  );
  assert.ok(
    !source.includes("WORKER_SECRET"),
    "Must NOT reference WORKER_SECRET",
  );
  assert.ok(
    !source.includes('searchParams.get("token")'),
    "Must NOT check query param token",
  );
});

test("cron-forward-ledger route: uses CRON_SECRET, no query params", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/app/api/pulse/cron-forward-ledger/route.ts", "utf-8");

  assert.ok(
    source.includes("CRON_SECRET"),
    "Must check CRON_SECRET for cron auth",
  );
  assert.ok(
    source.includes("forwardLedgerBatch"),
    "Must call shared core function",
  );
});

test("health route: returns health metrics and checks degraded thresholds", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/app/api/pulse/forward-ledger/health/route.ts", "utf-8");

  assert.ok(source.includes("backlog_unforwarded"), "Must report unforwarded backlog");
  assert.ok(source.includes("backlog_claimed"), "Must report claimed count");
  assert.ok(source.includes("deadlettered"), "Must report deadlettered count");
  assert.ok(source.includes("failed_last_hour"), "Must report recent failures");
  assert.ok(source.includes("max_attempts_seen"), "Must report max attempts");
  assert.ok(source.includes("emitObserverEvent"), "Must emit degraded signal");
  assert.ok(source.includes("pulse.forwarder"), "Degraded signal must reference pulse.forwarder");
});

// ─── Idempotency structural test ────────────────────────────────────────────

test("idempotency: claimed_at IS NULL guard prevents double-claim", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  // The claim step must include the IS NULL guard
  // Count occurrences: claim step should use .is("pulse_forward_claimed_at", null)
  const claimGuardCount = (source.match(/\.is\("pulse_forward_claimed_at",\s*null\)/g) || []).length;
  assert.ok(
    claimGuardCount >= 2,
    `Must use IS NULL guard on pulse_forward_claimed_at in multiple places (selection + claim), found ${claimGuardCount}`,
  );
});

// ─── Concurrency structural test ────────────────────────────────────────────

test("concurrency: claim uses per-row atomic update", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  // The claim loop must update individual rows by ID with IS NULL guard
  assert.ok(
    source.includes('.eq("id", candidate.id)'),
    "Must claim rows individually by ID",
  );
  assert.ok(
    source.includes("maybeSingle"),
    "Must use maybeSingle to detect claim success",
  );
});

// ─── vercel.json: no secrets in cron URL ────────────────────────────────────

test("vercel.json: pulse cron has no secrets in URL", async () => {
  const fs = await import("node:fs");
  const config = JSON.parse(fs.readFileSync("vercel.json", "utf-8"));

  const pulseCron = config.crons.find(
    (c: { path: string }) => c.path.includes("pulse") && c.path.includes("cron"),
  );
  assert.ok(pulseCron, "Must have a pulse cron entry");
  assert.ok(
    !pulseCron.path.includes("token="),
    "Cron path must NOT contain token query param",
  );
  assert.ok(
    !pulseCron.path.includes("SECRET"),
    "Cron path must NOT contain SECRET",
  );
  // Cadence was relaxed from */2 to */5 by the worker-hardening patch — the
  // forwarder is now singleton via advisory lock and short-circuits on idle,
  // so the older cadence was burning Supabase RPS for no benefit.
  assert.equal(pulseCron.schedule, "*/5 * * * *", "Must run every 5 minutes");
});

// ─── Idle-probe regression: stale claims are work, not idle ────────────────
//
// Bug: the first version of the idle probe filtered on
// `pulse_forward_claimed_at IS NULL` only. A row claimed by a worker that
// crashed before delivery would be invisible to the probe — so the forwarder
// would early-return idle_no_work even though Step 1 (reclaim stale claims)
// would have unstuck it. These tests prevent that regression.

test("forwarder idle probe: source includes stale-threshold OR clause", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  // The probe must use .or() with both branches: claimed_at IS NULL OR
  // claimed_at < staleThreshold. An equivalent regex captures the shape.
  const probeBlock = source.split("Idle probe:")[1] ?? "";
  assert.ok(probeBlock.length > 0, "Idle probe section must exist");

  assert.match(
    probeBlock,
    /\.or\(\s*[`"']pulse_forward_claimed_at\.is\.null,pulse_forward_claimed_at\.lt\.\$\{staleThreshold\}/,
    "probe .or() must include both is.null and lt.${staleThreshold} for pulse_forward_claimed_at",
  );

  // Belt-and-suspenders: probe must NOT use the standalone
  // .is("pulse_forward_claimed_at", null) filter — that was the original bug.
  // (We allow the literal in the candidate-select path further down, so
  //  scope the assertion to the probe block before "Step 1: Reclaim".)
  const probeOnly = probeBlock.split(/Step 1: Reclaim/)[0] ?? "";
  assert.doesNotMatch(
    probeOnly,
    /\.is\(\s*"pulse_forward_claimed_at"\s*,\s*null\s*\)/,
    "probe must NOT use standalone .is(pulse_forward_claimed_at, null) — that hides stale claims",
  );
});

test("forwarder idle probe: stale-claimed row is treated as work, not idle", async () => {
  // Stub Supabase client. The probe runs:
  //   from('deal_pipeline_ledger').select('id').is(...).is(...).or(...).limit(1)
  // We capture the .or(...) argument and return a stale-claimed row to assert
  // forwardLedgerBatch keeps going past the probe rather than short-circuiting.
  const calls: { method: string; args: unknown[] }[] = [];
  let probeOrFilter = "";

  // Two builders: probe (returns one row), candidate-select (returns []).
  let selectCount = 0;
  function makeBuilder() {
    const builder: any = {
      _select: "",
      from(table: string) {
        calls.push({ method: "from", args: [table] });
        return builder;
      },
      select(cols: string) {
        builder._select = cols;
        calls.push({ method: "select", args: [cols] });
        selectCount++;
        return builder;
      },
      update() {
        calls.push({ method: "update", args: [] });
        return builder;
      },
      is(col: string, val: unknown) {
        calls.push({ method: "is", args: [col, val] });
        return builder;
      },
      lt(col: string, val: unknown) {
        calls.push({ method: "lt", args: [col, val] });
        return builder;
      },
      or(expr: string) {
        if (!probeOrFilter) probeOrFilter = expr;
        calls.push({ method: "or", args: [expr] });
        return builder;
      },
      order() {
        return builder;
      },
      eq() {
        return builder;
      },
      limit(_n: number) {
        // Probe (1st select on this table): return one stale-claimed row
        // Candidate select (2nd): return [] so the test ends quickly
        if (selectCount === 1) {
          return Promise.resolve({
            data: [{ id: "stale-row-1" }],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      },
    };
    return builder;
  }

  const builder = makeBuilder();
  const sb: any = {
    from: (t: string) => builder.from(t),
  };

  // Set required env so the kill-switch and config gates pass.
  const prevEnabled = process.env.PULSE_TELEMETRY_ENABLED;
  const prevUrl = process.env.PULSE_BUDDY_INGEST_URL;
  const prevToken = process.env.PULSE_INGEST_TOKEN;
  process.env.PULSE_TELEMETRY_ENABLED = "true";
  process.env.PULSE_BUDDY_INGEST_URL = "https://example.invalid/ingest";
  process.env.PULSE_INGEST_TOKEN = "test-token";

  try {
    const { forwardLedgerBatch } = await import("../forwardLedgerCore");
    const result = await forwardLedgerBatch({ max: 5, sb });

    // The contract: stale-claimed rows must NOT register as idle. Even though
    // the probe got 1 row back, no candidates were claimed downstream, so we
    // expect a normal (non-idle) result with attempted=0.
    assert.notEqual(
      (result as any).reason,
      "idle_no_work",
      "stale-claimed rows must NOT trigger idle_no_work",
    );
    assert.equal(result.skipped, undefined);
    assert.equal(result.attempted, 0);

    // Probe filter must include both is.null and lt.${staleThreshold}.
    assert.match(
      probeOrFilter,
      /pulse_forward_claimed_at\.is\.null/,
      "probe must include the unclaimed branch",
    );
    assert.match(
      probeOrFilter,
      /pulse_forward_claimed_at\.lt\./,
      "probe must include the stale-threshold branch",
    );

    // Probe phase (everything before Step 1's `update` call) must NOT use
    // a standalone is(pulse_forward_claimed_at, null) — that was the bug.
    // Step 2 candidate-select legitimately uses it because Step 1 already
    // reclaimed any stale rows.
    const firstUpdateIdx = calls.findIndex((c) => c.method === "update");
    const probeCalls =
      firstUpdateIdx === -1 ? calls : calls.slice(0, firstUpdateIdx);
    const standaloneInProbe = probeCalls.find(
      (c) =>
        c.method === "is" &&
        c.args[0] === "pulse_forward_claimed_at" &&
        c.args[1] === null,
    );
    assert.equal(
      standaloneInProbe,
      undefined,
      "probe must not call .is(pulse_forward_claimed_at, null) — that hides stale claims",
    );
  } finally {
    if (prevEnabled === undefined) delete process.env.PULSE_TELEMETRY_ENABLED;
    else process.env.PULSE_TELEMETRY_ENABLED = prevEnabled;
    if (prevUrl === undefined) delete process.env.PULSE_BUDDY_INGEST_URL;
    else process.env.PULSE_BUDDY_INGEST_URL = prevUrl;
    if (prevToken === undefined) delete process.env.PULSE_INGEST_TOKEN;
    else process.env.PULSE_INGEST_TOKEN = prevToken;
  }
});

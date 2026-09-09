import test from "node:test";
import assert from "node:assert/strict";

import { advanceDealLifecycle } from "@/lib/deals/advanceDealLifecycleCore";

function createLifecycleDb(opts?: {
  stage?: string;
  bankId?: string | null;
  lookupError?: Error | null;
  updateError?: Error | null;
  silentUpdate?: boolean;
  /** Another caller advances the row between this caller's read and write. */
  concurrentWinner?: boolean;
}) {
  let stage = opts?.stage ?? "collecting";
  const bankId = opts?.bankId === undefined ? "bank-1" : opts.bankId;

  return {
    get stage() {
      return stage;
    },
    from(table: string) {
      assert.equal(table, "deals");
      const builder: any = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        maybeSingle: async () => ({
          data: opts?.lookupError
            ? null
            : { id: "deal-1", bank_id: bankId, stage },
          error: opts?.lookupError ?? null,
        }),
        update(patch: { stage: string }) {
          const filters: Array<[string, string]> = [];
          const chain: any = {
            eq(column: string, value: string) {
              filters.push([column, value]);
              return chain;
            },
            select: async () => {
              if (opts?.updateError) return { data: null, error: opts.updateError };
              if (opts?.silentUpdate) return { data: [], error: null };
              if (opts?.concurrentWinner) {
                // The other caller's write landed first: the row is already at
                // the target, and our conditional write matched nothing.
                stage = patch.stage;
                return { data: [], error: null };
              }
              // Conditional write: only matches when the stage filter still holds.
              const stageFilter = filters.find(([c]) => c === "stage")?.[1];
              if (stageFilter !== undefined && stageFilter !== stage) return { data: [], error: null };
              stage = patch.stage;
              return { data: [{ id: "deal-1" }], error: null };
            },
          };
          return chain;
        },
      };
      return builder;
    },
  };
}

function params(
  sb: ReturnType<typeof createLifecycleDb>,
  overrides?: {
    writeEvent?: () => Promise<{ ok: boolean; error?: string }>;
    logLedgerEvent?: () => Promise<{ ok: boolean; error?: string }>;
  },
) {
  return {
    dealId: "deal-1",
    toStage: "underwriting" as const,
    reason: "readiness_proven",
    source: "test",
    actor: { type: "system" as const, label: "test" },
    deps: {
      sb,
      writeEvent: overrides?.writeEvent ?? (async () => ({ ok: true })),
      logLedgerEvent:
        overrides?.logLedgerEvent ?? (async () => ({ ok: true })),
    },
  };
}

test("does not report success when Supabase UPDATE affects no row", async () => {
  const sb = createLifecycleDb({ silentUpdate: true });
  const result = await advanceDealLifecycle(params(sb));

  assert.deepEqual(result, {
    ok: false,
    error: "lifecycle_persistence_unproven",
    from: "collecting",
    to: "underwriting",
  });
  assert.equal(sb.stage, "collecting");
});

test("distinguishes lookup failure from a missing deal", async () => {
  const sb = createLifecycleDb({ lookupError: new Error("database offline") });
  const result = await advanceDealLifecycle(params(sb));
  assert.deepEqual(result, { ok: false, error: "deal_lookup_failed" });
});

test("does not report completion when canonical lifecycle event fails", async () => {
  const sb = createLifecycleDb();
  let pipelineCalled = false;
  const result = await advanceDealLifecycle(
    params(sb, {
      writeEvent: async () => ({ ok: false, error: "insert denied" }),
      logLedgerEvent: async () => {
        pipelineCalled = true;
        return { ok: true };
      },
    }),
  );

  assert.ok(!result.ok);
  assert.equal(result.error, "lifecycle_event_write_failed");
  assert.equal(result.stage_persisted, true);
  assert.equal(pipelineCalled, false);
});

test("does not report completion when pipeline evidence fails", async () => {
  const sb = createLifecycleDb();
  const result = await advanceDealLifecycle(
    params(sb, {
      logLedgerEvent: async () => ({ ok: false, error: "constraint" }),
    }),
  );

  assert.ok(!result.ok);
  assert.equal(result.error, "pipeline_event_write_failed");
  assert.equal(result.stage_persisted, true);
  assert.equal(result.event_persisted, true);
});

test("reports success only after state and both evidence writes persist", async () => {
  const sb = createLifecycleDb();
  const result = await advanceDealLifecycle(params(sb));
  assert.deepEqual(result, {
    ok: true,
    from: "collecting",
    to: "underwriting",
  });
  assert.equal(sb.stage, "underwriting");
});

test("a caller that lost a concurrent race reports already:true and records no transition", async () => {
  // Production 2026-09-09 16:15 UTC: the rail poll and the readiness refresh
  // both read "underwriting", both advanced to "ready", and both wrote a
  // deal.lifecycle.advanced event for the same transition.
  const sb = createLifecycleDb({ stage: "underwriting", concurrentWinner: true });
  let events = 0;
  const result = await advanceDealLifecycle({
    ...params(sb),
    toStage: "ready" as const,
    deps: {
      sb,
      writeEvent: async () => { events += 1; return { ok: true }; },
      logLedgerEvent: async () => { events += 1; return { ok: true }; },
    },
  });
  assert.deepEqual(result, { ok: true, already: true, stage: "ready", concurrent: true });
  assert.equal(events, 0, "the loser must not record the transition again");
  assert.equal(sb.stage, "ready");
});

test("the caller whose conditional write matches records exactly one transition", async () => {
  const sb = createLifecycleDb({ stage: "underwriting" });
  let events = 0;
  const result = await advanceDealLifecycle({
    ...params(sb),
    toStage: "ready" as const,
    deps: {
      sb,
      writeEvent: async () => { events += 1; return { ok: true }; },
      logLedgerEvent: async () => ({ ok: true }),
    },
  });
  assert.equal(result.ok, true);
  assert.equal((result as any).already, undefined);
  assert.equal(events, 1);
  assert.equal(sb.stage, "ready");
});

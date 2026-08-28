import test from "node:test";
import assert from "node:assert/strict";

import { advanceDealLifecycle } from "@/lib/deals/advanceDealLifecycleCore";

function createLifecycleDb(opts?: {
  stage?: string;
  bankId?: string | null;
  lookupError?: Error | null;
  updateError?: Error | null;
  silentUpdate?: boolean;
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
          return {
            eq: async () => {
              if (!opts?.updateError && !opts?.silentUpdate) stage = patch.stage;
              return { error: opts?.updateError ?? null };
            },
          };
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

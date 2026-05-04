import test from "node:test";
import assert from "node:assert/strict";

import {
  withWorkerAdvisoryLock,
  WORKER_LOCK_KEYS,
  isWorkerLockSkip,
} from "../workerLock";

type RpcCall = { name: string; args: Record<string, unknown> };

function makeFakeClient(opts: {
  acquire: boolean;
  acquireError?: { message: string } | null;
  acquireThrow?: Error;
  unlockError?: { message: string } | null;
}) {
  const calls: RpcCall[] = [];
  return {
    calls,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "pg_try_advisory_lock") {
        if (opts.acquireThrow) throw opts.acquireThrow;
        return {
          data: opts.acquire,
          error: opts.acquireError ?? null,
        };
      }
      if (name === "pg_advisory_unlock") {
        return {
          data: opts.acquire,
          error: opts.unlockError ?? null,
        };
      }
      return { data: null, error: null };
    },
  };
}

test("workerLock: lock keys are unique bigints", () => {
  const values = Object.values(WORKER_LOCK_KEYS);
  assert.equal(new Set(values).size, values.length, "lock keys must be unique");
  for (const v of values) {
    assert.equal(typeof v, "number");
    assert.ok(Number.isFinite(v));
  }
});

test("workerLock: run executes when advisory lock is acquired", async () => {
  const fake = makeFakeClient({ acquire: true });
  let ran = false;
  const result = await withWorkerAdvisoryLock({
    sb: fake as any,
    lockKey: WORKER_LOCK_KEYS.PULSE_OUTBOX,
    workerName: "test",
    run: async () => {
      ran = true;
      return { processed: 7 };
    },
  });

  assert.equal(ran, true, "run() must be invoked when lock is acquired");
  assert.deepEqual(result, { processed: 7 });
  // Lock acquired then released
  assert.equal(fake.calls[0].name, "pg_try_advisory_lock");
  assert.equal(fake.calls[fake.calls.length - 1].name, "pg_advisory_unlock");
  assert.equal(
    fake.calls[0].args.lock_id,
    WORKER_LOCK_KEYS.PULSE_OUTBOX,
  );
});

test("workerLock: run does NOT execute when lock not acquired", async () => {
  const fake = makeFakeClient({ acquire: false });
  let ran = false;
  const result = await withWorkerAdvisoryLock({
    sb: fake as any,
    lockKey: WORKER_LOCK_KEYS.DOC_EXTRACTION_OUTBOX,
    workerName: "test",
    run: async () => {
      ran = true;
      return { processed: 1 };
    },
  });

  assert.equal(ran, false, "run() must NOT be invoked when lock not acquired");
  assert.ok(isWorkerLockSkip(result));
  if (isWorkerLockSkip(result)) {
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "lock_not_acquired");
  }
  // Should NOT call unlock when never acquired
  assert.equal(
    fake.calls.filter((c) => c.name === "pg_advisory_unlock").length,
    0,
    "unlock must not run when lock was not acquired",
  );
});

test("workerLock: returns skip when acquire RPC errors", async () => {
  const fake = makeFakeClient({
    acquire: false,
    acquireError: { message: "permission denied" },
  });
  let ran = false;
  const result = await withWorkerAdvisoryLock({
    sb: fake as any,
    lockKey: WORKER_LOCK_KEYS.INTAKE_OUTBOX,
    workerName: "test",
    run: async () => {
      ran = true;
      return null;
    },
  });
  assert.equal(ran, false);
  assert.ok(isWorkerLockSkip(result));
});

test("workerLock: returns skip when acquire RPC throws", async () => {
  const fake = makeFakeClient({
    acquire: false,
    acquireThrow: new Error("network down"),
  });
  let ran = false;
  const result = await withWorkerAdvisoryLock({
    sb: fake as any,
    lockKey: WORKER_LOCK_KEYS.LEDGER_FORWARDER,
    workerName: "test",
    run: async () => {
      ran = true;
      return null;
    },
  });
  assert.equal(ran, false);
  assert.ok(isWorkerLockSkip(result));
});

test("workerLock: unlocks even when run() throws", async () => {
  const fake = makeFakeClient({ acquire: true });
  await assert.rejects(
    () =>
      withWorkerAdvisoryLock({
        sb: fake as any,
        lockKey: WORKER_LOCK_KEYS.SPREADS_WORKER,
        workerName: "test",
        run: async () => {
          throw new Error("boom");
        },
      }),
    /boom/,
  );
  const unlocks = fake.calls.filter(
    (c) => c.name === "pg_advisory_unlock",
  );
  assert.equal(unlocks.length, 1, "must release lock even when run() throws");
});

test("workerLock: unlock failure does not throw", async () => {
  const fake = makeFakeClient({
    acquire: true,
    unlockError: { message: "unlock failed" },
  });
  // Should NOT throw, even when unlock RPC returns an error
  const result = await withWorkerAdvisoryLock({
    sb: fake as any,
    lockKey: WORKER_LOCK_KEYS.PULSE_OUTBOX,
    workerName: "test",
    run: async () => "ok",
  });
  assert.equal(result, "ok");
});

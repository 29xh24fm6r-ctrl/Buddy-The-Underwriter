import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const m = require("../commsMode") as typeof import("../commsMode");

function withEnv(value: string | undefined, fn: () => void) {
  const orig = process.env.BROKERAGE_COMMS_MODE;
  if (value === undefined) delete process.env.BROKERAGE_COMMS_MODE;
  else process.env.BROKERAGE_COMMS_MODE = value;
  try {
    fn();
  } finally {
    if (orig === undefined) delete process.env.BROKERAGE_COMMS_MODE;
    else process.env.BROKERAGE_COMMS_MODE = orig;
  }
}

test("resolveCommsMode: unset defaults to stub", () => {
  withEnv(undefined, () => {
    assert.equal(m.resolveCommsMode(), "stub");
  });
});

test("resolveCommsMode: empty string defaults to stub", () => {
  withEnv("", () => {
    assert.equal(m.resolveCommsMode(), "stub");
  });
});

test("resolveCommsMode: accepts valid values", () => {
  withEnv("stub", () => assert.equal(m.resolveCommsMode(), "stub"));
  withEnv("dry_run", () => assert.equal(m.resolveCommsMode(), "dry_run"));
  withEnv("live", () => assert.equal(m.resolveCommsMode(), "live"));
});

test("resolveCommsMode: unknown value throws", () => {
  withEnv("bogus", () => {
    assert.throws(() => m.resolveCommsMode(), /Invalid BROKERAGE_COMMS_MODE/);
  });
});

test("logCommsModeResolvedOnce: writes exactly one ledger row per boot", async () => {
  m.__resetCommsModeBootLogForTests();
  const inserts: any[] = [];
  const sb = {
    from(_table: string) {
      return {
        insert: async (row: any) => {
          inserts.push(row);
          return { data: null, error: null };
        },
      };
    },
  };

  await withEnvAsync("live", async () => {
    const mode1 = await m.logCommsModeResolvedOnce(sb);
    const mode2 = await m.logCommsModeResolvedOnce(sb);
    assert.equal(mode1, "live");
    assert.equal(mode2, "live");
  });

  assert.equal(inserts.length, 1, "should log once per boot, not per call");
  assert.equal(inserts[0].event_type, "comms_mode_resolved");
  assert.equal(inserts[0].metadata.mode, "live");
});

test("logCommsModeResolvedOnce: throws before logging on unknown mode", async () => {
  m.__resetCommsModeBootLogForTests();
  const inserts: any[] = [];
  const sb = {
    from(_table: string) {
      return {
        insert: async (row: any) => {
          inserts.push(row);
          return { data: null, error: null };
        },
      };
    },
  };

  await withEnvAsync("bogus", async () => {
    await assert.rejects(() => m.logCommsModeResolvedOnce(sb));
  });
  assert.equal(inserts.length, 0);
});

async function withEnvAsync(value: string | undefined, fn: () => Promise<void>) {
  const orig = process.env.BROKERAGE_COMMS_MODE;
  if (value === undefined) delete process.env.BROKERAGE_COMMS_MODE;
  else process.env.BROKERAGE_COMMS_MODE = value;
  try {
    await fn();
  } finally {
    if (orig === undefined) delete process.env.BROKERAGE_COMMS_MODE;
    else process.env.BROKERAGE_COMMS_MODE = orig;
  }
}

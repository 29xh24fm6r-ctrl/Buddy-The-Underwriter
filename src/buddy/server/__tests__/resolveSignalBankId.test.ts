import test from "node:test";
import assert from "node:assert/strict";

import { resolveSignalBankId, type SignalTenantDeps } from "@/buddy/server/resolveSignalBankId";
import type { BuddySignalBase } from "@/buddy/signals";

function makeDeps(opts?: {
  dealBankId?: string | null;
  sessionBankId?: string | null;
  sessionThrows?: boolean;
}) {
  const calls = { deal: [] as string[], session: 0 };
  const deps: SignalTenantDeps = {
    dealBankId: async (dealId) => {
      calls.deal.push(dealId);
      return opts?.dealBankId === undefined ? "bank-from-deal" : opts.dealBankId;
    },
    sessionBankId: async () => {
      calls.session += 1;
      if (opts?.sessionThrows) throw new Error("not_authenticated");
      return opts?.sessionBankId === undefined ? "bank-from-session" : opts.sessionBankId;
    },
  };
  return { deps, calls };
}

function signal(over: Partial<BuddySignalBase>): BuddySignalBase {
  return { type: "deal.checklist.updated", ts: 1, source: "test", ...over };
}

test("deal-scoped signal resolves from the deal row and never touches the session", async () => {
  const { deps, calls } = makeDeps();
  const bankId = await resolveSignalBankId(signal({ dealId: "deal-1" }), deps);
  assert.equal(bankId, "bank-from-deal");
  assert.deepEqual(calls.deal, ["deal-1"]);
  assert.equal(calls.session, 0);
});

test("deal-scoped signal for an unknown deal yields null without consulting the session", async () => {
  const { deps, calls } = makeDeps({ dealBankId: null });
  const bankId = await resolveSignalBankId(signal({ dealId: "deal-missing" }), deps);
  assert.equal(bankId, null);
  assert.equal(calls.session, 0);
});

test("explicit bankId wins without any lookup", async () => {
  const { deps, calls } = makeDeps();
  const bankId = await resolveSignalBankId(
    signal({ dealId: "deal-1", bankId: "bank-explicit" }),
    deps,
  );
  assert.equal(bankId, "bank-explicit");
  assert.deepEqual(calls.deal, []);
  assert.equal(calls.session, 0);
});

test("blank explicit bankId is ignored", async () => {
  const { deps } = makeDeps();
  const bankId = await resolveSignalBankId(signal({ dealId: "deal-1", bankId: "  " }), deps);
  assert.equal(bankId, "bank-from-deal");
});

test("tenant-level signal without a deal falls back to the session", async () => {
  const { deps, calls } = makeDeps();
  const bankId = await resolveSignalBankId(signal({ type: "user.action" }), deps);
  assert.equal(bankId, "bank-from-session");
  assert.equal(calls.session, 1);
  assert.deepEqual(calls.deal, []);
});

test("tenant-level signal with no session yields null instead of rejecting", async () => {
  const { deps } = makeDeps({ sessionThrows: true });
  const bankId = await resolveSignalBankId(signal({ type: "user.action" }), deps);
  assert.equal(bankId, null);
});

test("deal lookup failure yields null instead of rejecting or consulting the session", async () => {
  let session = 0;
  const bankId = await resolveSignalBankId(signal({ dealId: "deal-1" }), {
    dealBankId: async () => {
      throw new Error("db down");
    },
    sessionBankId: async () => {
      session += 1;
      return "bank-from-session";
    },
  });
  assert.equal(bankId, null);
  assert.equal(session, 0);
});

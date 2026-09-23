import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
const { withPackageRoleSlot } = require("../packageRoleScheduler") as typeof import("../packageRoleScheduler");
const { runWithAIExecutionContext } = require("../executionContext") as typeof import("../executionContext");
const { reserveGatewayBudget, settleGatewayBudget, GatewayBudgetExceededError } = require("../budget") as typeof import("../budget");
const context = (id = "qa-run") => ({ dealId: "qa-deal", traceId: id, artifactId: id, artifactType: "trident_bundle", npiTagged: true });
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test("seven concurrent narratives settle real reservation contracts without reproducing the 150k burst failure", async () => {
  let consumed = 36447, reserved = 0, attempts = 0, peak = 0;
  const reservations = new Map<string, number>();
  const client: any = { rpc(name: string, args: any) {
    if (name === "settle_ai_gateway_tokens") {
      reserved -= reservations.get(args.p_reservation_id)!;
      reservations.delete(args.p_reservation_id);
      consumed += args.p_actual_tokens;
      return Promise.resolve({ data: true, error: null });
    }
    assert.equal(name, "reserve_trident_gateway_tokens");
    assert.equal(args.p_run_id, "qa-run");
    const allowed = consumed + reserved + args.p_requested_tokens <= 150000;
    attempts++;
    const id = `reservation-${attempts}`;
    if (allowed) { reserved += args.p_requested_tokens; reservations.set(id, args.p_requested_tokens); }
    peak = Math.max(peak, reserved);
    return { single: async () => ({ data: { allowed, reservation_id: allowed ? id : null, tokens_consumed: consumed + reserved, tokens_reserved: 0 }, error: null }) };
  } };
  const results = await runWithAIExecutionContext(context(), () => Promise.all(Array.from({ length: 7 }, (_, section) =>
    withPackageRoleSlot("generator", async () => {
      const reservation = await reserveGatewayBudget("generator", 2000000, 21500, client);
      await turn(); // provider work remains in flight until its usage is settled
      await settleGatewayBudget(reservation, 5500, client);
      return section;
    }))));
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(attempts, 7);
  assert.equal(peak, 21500);
  assert.equal(reserved, 0);
  assert.equal(consumed, 74947);
});

test("a hard admission denial drains the queue without more reservations or provider attempts", async () => {
  let calls = 0;
  const result = await runWithAIExecutionContext(context("exhausted"), () => Promise.allSettled(Array.from({ length: 7 }, () =>
    withPackageRoleSlot("generator", async () => {
      calls++;
      throw new GatewayBudgetExceededError("Package token budget exceeded");
    }))));
  assert.equal(calls, 1);
  assert.equal(result.filter(r => r.status === "rejected").length, 7);
  assert.equal(await runWithAIExecutionContext(context("exhausted"), () => withPackageRoleSlot("generator", async () => "new admission")), "new admission", "drained queues must not leak across future invocations");
});

test("separate runs and roles can progress while a package call is pending", async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = runWithAIExecutionContext(context("first"), () => withPackageRoleSlot("generator", async () => {
    entered(); await new Promise<void>(resolve => { release = resolve; }); return "first";
  }));
  await started;
  assert.equal(await runWithAIExecutionContext(context("second"), () => withPackageRoleSlot("generator", async () => "second")), "second");
  assert.equal(await runWithAIExecutionContext(context("first"), () => withPackageRoleSlot("verifier", async () => "review")), "review");
  release(); await pending;
});

test("the real gateway schedules package calls through completion and retains provenance", async () => {
  const gateway = require("../gateway") as typeof import("../gateway");
  const approval = require("../vendorApproval") as typeof import("../vendorApproval");
  let active = 0, peak = 0;
  const purposes: string[] = [];
  approval.__setVendorApprovalForTests("google", "APPROVED");
  gateway.__setProviderImplForTests("google", async () => {
    peak = Math.max(peak, ++active); await turn(); active--;
    return { text: "saved section", tokensIn: 10, tokensOut: 10 };
  });
  gateway.__setLogGatewayCallForTests(async entry => { assert.equal(entry.traceId, "gateway-run"); assert.equal(entry.npiTagged, true); purposes.push(entry.purpose); return true; });
  try {
    const results = await runWithAIExecutionContext(context("gateway-run"), () => Promise.all(Array.from({ length: 7 }, (_, n) => gateway.runRole("generator", { prompt: "synthetic", purpose: `section-${n}` }))));
    assert.equal(results.length, 7); assert.equal(peak, 1);
    assert.deepEqual(purposes, Array.from({ length: 7 }, (_, n) => `section-${n}`));
  } finally { gateway.__resetGatewayTestOverrides(); gateway.__resetGatewayBudgetForTests(); approval.__resetVendorApprovalForTests(); }
});

test("package rejection diagnostics distinguish reservation accounting from all three limits", async () => {
  const client: any = { rpc: () => ({ single: async () => ({ data: { allowed: false, tokens_consumed: 144038, tokens_reserved: 0 }, error: null }) }) };
  await assert.rejects(runWithAIExecutionContext(context(), () => reserveGatewayBudget("generator", 2000000, 21485, client)), (error: any) => {
    assert.match(error.message, /144038 settled or reserved/);
    assert.match(error.message, /150000 per run/);
    assert.match(error.message, /1000000 QA/);
    assert.match(error.message, /2000000 total/);
    assert.doesNotMatch(error.message, /144038 consumed/);
    return true;
  });
});

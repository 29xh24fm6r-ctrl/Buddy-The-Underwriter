import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { resolvePortalToken } =
  require("../portalTokenAuth") as typeof import("../portalTokenAuth");

type RpcResponse = {
  data: unknown;
  error: { message: string } | null;
};

function clientReturning(response: RpcResponse) {
  const calls: Array<{ name: string; args: unknown }> = [];
  return {
    calls: () => calls,
    rpc(name: string, args: unknown) {
      calls.push({ name, args });
      return Promise.resolve(response);
    },
  };
}

test("a live link resolves through the canonical state-machine RPC", async () => {
  const client = clientReturning({
    data: [{ deal_id: "deal-1", bank_id: "bank-1", label: null }],
    error: null,
  });
  const ctx = await resolvePortalToken("tok-live", client as any);
  assert.deepEqual(ctx, { token: "tok-live", dealId: "deal-1" });
  assert.deepEqual(client.calls(), [
    { name: "peek_borrower_portal_link", args: { p_token: "tok-live" } },
  ]);
});

for (const code of [
  "link_expired",
  "link_revoked",
  "link_consumed",
  "link_not_found",
]) {
  test(`${code} is rejected without leaking link state`, async () => {
    const ctx = await resolvePortalToken(
      `tok-${code}`,
      clientReturning({ data: null, error: { message: code } }) as any,
    );
    assert.equal(ctx, null);
  });
}

test("an indeterminate RPC failure fails closed", async () => {
  const ctx = await resolvePortalToken(
    "tok-rpc-failed",
    clientReturning({ data: null, error: { message: "connection failed" } }) as any,
  );
  assert.equal(ctx, null);
});

test("an empty token is rejected without a lookup", async () => {
  const client = clientReturning({ data: null, error: null });
  assert.equal(await resolvePortalToken("", client as any), null);
  assert.equal(
    await resolvePortalToken(undefined as unknown as string, client as any),
    null,
  );
  assert.deepEqual(client.calls(), []);
});

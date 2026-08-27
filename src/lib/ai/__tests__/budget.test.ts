import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequire } from "node:module";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const {
  estimateGatewayReservation,
  estimateTextTokenUpperBound,
  GatewayBudgetExceededError,
  GatewayBudgetPersistenceError,
  reserveGatewayBudget,
  settleGatewayBudget,
} = require("../budget") as typeof import("../budget");

type RpcCall = { name: string; args: Record<string, unknown> };

function reservationClient(
  response: { data: unknown; error: { message: string } | null },
  calls: RpcCall[],
): SupabaseClient {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { single: async () => response };
    },
  } as unknown as SupabaseClient;
}

describe("durable AI budget estimation", () => {
  it("uses a UTF-8 byte upper bound for multilingual text", () => {
    assert.equal(estimateTextTokenUpperBound("借"), 3);
    assert.equal(estimateTextTokenUpperBound("hello"), 5);
  });

  it("reserves input, schema, inline data, and configured output capacity", () => {
    const estimate = estimateGatewayReservation({
      prompt: "hi",
      responseSchema: { type: "object" },
      inlineData: [{ mimeType: "application/pdf", data: "AAAA" }],
      maxOutputTokens: 10,
    });
    assert.ok(estimate >= 16);
  });
});

describe("durable AI budget RPC contract", () => {
  it("returns a reservation from the atomic service RPC", async () => {
    const calls: RpcCall[] = [];
    const client = reservationClient(
      {
        data: {
          allowed: true,
          reservation_id: "4d2621b6-924b-4fac-8e4d-787b59fb9a5f",
          tokens_consumed: 20,
          tokens_reserved: 30,
        },
        error: null,
      },
      calls,
    );

    const result = await reserveGatewayBudget("embedder", 100, 10, client);
    assert.equal(result.id, "4d2621b6-924b-4fac-8e4d-787b59fb9a5f");
    assert.equal(result.reservedTokens, 10);
    assert.deepEqual(calls, [
      {
        name: "reserve_ai_gateway_tokens",
        args: {
          p_role: "embedder",
          p_requested_tokens: 10,
          p_daily_budget: 100,
        },
      },
    ]);
  });

  it("throws a typed hard-stop when aggregate capacity is exhausted", async () => {
    const client = reservationClient(
      {
        data: {
          allowed: false,
          reservation_id: null,
          tokens_consumed: 80,
          tokens_reserved: 20,
        },
        error: null,
      },
      [],
    );

    await assert.rejects(
      () => reserveGatewayBudget("generator", 100, 10, client),
      GatewayBudgetExceededError,
    );
  });

  it("throws a typed persistence error when admission cannot be proven", async () => {
    const client = reservationClient(
      { data: null, error: { message: "database unavailable" } },
      [],
    );

    await assert.rejects(
      () => reserveGatewayBudget("generator", 100, 10, client),
      GatewayBudgetPersistenceError,
    );
  });

  it("requires settlement to confirm the reservation", async () => {
    const client = {
      async rpc() {
        return { data: false, error: null };
      },
    } as unknown as SupabaseClient;

    await assert.rejects(
      () =>
        settleGatewayBudget(
          { id: "4d2621b6-924b-4fac-8e4d-787b59fb9a5f", reservedTokens: 10 },
          7,
          client,
        ),
      GatewayBudgetPersistenceError,
    );
  });
});

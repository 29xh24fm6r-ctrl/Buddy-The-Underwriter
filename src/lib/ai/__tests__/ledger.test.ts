/**
 * SPEC-M1 AI-GATEWAY-1 — ledger.ts (logGatewayCall) unit tests.
 *
 * Uses an injected fake Supabase client rather than a real one — never
 * exercises the default `supabaseAdmin()` path here, since if this
 * environment happens to have real Supabase env vars set, that call would
 * be a live network write against production infrastructure. The
 * default-path safety (never-throw on missing env/client) is instead
 * checked structurally (TRIPWIRE test below), matching the convention in
 * openaiResilience.test.ts's "Structural Tripwires" section.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

// ledger.ts has `import "server-only"` — patch the CJS resolver before
// requiring it, same pattern as geminiClient.test.ts.
mockServerOnly();
const require = createRequire(import.meta.url);
const { logGatewayCall } = require("../ledger") as typeof import("../ledger");

function makeFakeClient(insertResult: { error: { message: string } | null }) {
  const calls: Array<{ table: string; row: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          calls.push({ table, row });
          return Promise.resolve(insertResult);
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("logGatewayCall", () => {
  it("inserts one row into ai_gateway_calls with the expected snake_case shape", async () => {
    const { client, calls } = makeFakeClient({ error: null });

    await logGatewayCall(
      {
        role: "generator",
        provider: "google",
        model: "gemini-3.1-flash-lite",
        tokensIn: 10,
        tokensOut: 20,
        latencyMs: 500,
        dealId: "deal-123",
        purpose: "test",
        npiTagged: false,
        outcome: "success",
      },
      client,
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].table, "ai_gateway_calls");
    assert.deepEqual(calls[0].row, {
      role: "generator",
      provider: "google",
      model: "gemini-3.1-flash-lite",
      tokens_in: 10,
      tokens_out: 20,
      latency_ms: 500,
      deal_id: "deal-123",
      purpose: "test",
      npi_tagged: false,
      outcome: "success",
      error_message: null,
    });
  });

  it("defaults error_message to null when not supplied", async () => {
    const { client, calls } = makeFakeClient({ error: null });
    await logGatewayCall(
      {
        role: "verifier",
        provider: "anthropic",
        model: "claude-sonnet-5",
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: 0,
        dealId: null,
        purpose: "verify_claims",
        npiTagged: true,
        outcome: "failure",
        errorMessage: "NPI-tagged request refused",
      },
      client,
    );
    assert.equal(calls[0].row.error_message, "NPI-tagged request refused");
  });

  it("never throws when the insert itself returns a Supabase error", async () => {
    const { client } = makeFakeClient({ error: { message: "relation does not exist" } });
    await assert.doesNotReject(() =>
      logGatewayCall(
        {
          role: "structurer",
          provider: "openai",
          model: "gpt-4o-2024-08-06",
          tokensIn: 5,
          tokensOut: 5,
          latencyMs: 100,
          dealId: null,
          purpose: "test",
          npiTagged: false,
          outcome: "success",
        },
        client,
      ),
    );
  });

  it("accepts role='embedder' (SPEC-GATEWAY-CAPABILITY-EXPANSION-1 §4 — not a GatewayRole, still ledgerable)", async () => {
    const { client, calls } = makeFakeClient({ error: null });
    await logGatewayCall(
      {
        role: "embedder",
        provider: "openai",
        model: "text-embedding-3-small",
        tokensIn: 7,
        tokensOut: 0,
        latencyMs: 50,
        dealId: null,
        purpose: "retrieval_query",
        npiTagged: false,
        outcome: "success",
      },
      client,
    );
    assert.equal(calls[0].row.role, "embedder");
  });

  it("never throws when the client itself throws synchronously", async () => {
    const throwingClient = {
      from() {
        throw new Error("boom");
      },
    } as unknown as SupabaseClient;

    await assert.doesNotReject(() =>
      logGatewayCall(
        {
          role: "generator",
          provider: "google",
          model: "x",
          tokensIn: 0,
          tokensOut: 0,
          latencyMs: 0,
          dealId: null,
          purpose: "test",
          npiTagged: false,
          outcome: "success",
        },
        throwingClient,
      ),
    );
  });
});

describe("TRIPWIRE: ledger.ts default-client resolution stays inside the try block", () => {
  it("resolves supabaseAdmin() inside the try, not as a default parameter value", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/ai/ledger.ts"), "utf8");
    assert.doesNotMatch(
      src,
      /client:\s*SupabaseClient\s*=\s*supabaseAdmin\(\)/,
      "supabaseAdmin() must not be a default parameter value — default params evaluate " +
        "outside the function body's try/catch, so a missing-env throw there would escape " +
        "as an unhandled rejection instead of being swallowed.",
    );
    assert.match(
      src,
      /client\s*\?\?\s*supabaseAdmin\(\)/,
      "supabaseAdmin() must be resolved inside the try block via `client ?? supabaseAdmin()`",
    );
  });
});

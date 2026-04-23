import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  translateResourceToToolCall,
  isReadResource,
  DEAL_ENTITY_TYPES,
} from "../translator";

// ---------------------------------------------------------------------------
// Source-grep assertions — guard the wire contract on invokeOmega.ts, which
// can't be imported at runtime under `import "server-only"`. These protect
// against regressions of rev 3.3's two wire-level fixes.
// ---------------------------------------------------------------------------

const SOURCE_PATH = path.resolve(__dirname, "../invokeOmega.ts");
const SOURCE = fs.readFileSync(SOURCE_PATH, "utf-8");

describe("invokeOmega.ts — wire contract (source-grep)", () => {
  it("uses x-pulse-mcp-key header, not Authorization Bearer", () => {
    assert.ok(
      SOURCE.includes('headers["x-pulse-mcp-key"]'),
      "must set x-pulse-mcp-key header",
    );
    assert.ok(
      !/headers\["Authorization"\]\s*=\s*`Bearer/.test(SOURCE),
      "must not set Authorization: Bearer header",
    );
  });

  it("reads OMEGA_MCP_KEY first, OMEGA_MCP_API_KEY as deprecated fallback", () => {
    assert.ok(
      SOURCE.includes("process.env.OMEGA_MCP_KEY"),
      "must read OMEGA_MCP_KEY",
    );
    assert.ok(
      SOURCE.includes("process.env.OMEGA_MCP_API_KEY"),
      "must keep OMEGA_MCP_API_KEY as fallback",
    );
    assert.ok(
      /deprecated OMEGA_MCP_API_KEY/.test(SOURCE),
      "must warn when deprecated fallback is used",
    );
  });

  it("uses tools/call JSON-RPC method, never a custom omega:// method", () => {
    assert.ok(
      /method:\s*"tools\/call"/.test(SOURCE),
      "must build body with method: 'tools/call'",
    );
    assert.ok(
      !/method:\s*resource/.test(SOURCE),
      "must not use resource as the JSON-RPC method",
    );
  });

  it("unwraps response: structuredContent → content[0] → full result", () => {
    assert.ok(
      SOURCE.includes("structuredContent"),
      "must check rpc.result.structuredContent first",
    );
    assert.ok(
      /content\?\.\[0\]/.test(SOURCE),
      "must fall back to content[0]",
    );
  });

  it("reads OMEGA_TARGET_USER_ID and injects via translator", () => {
    assert.ok(
      SOURCE.includes("getOmegaTargetUserId"),
      "must resolve target_user_id from env",
    );
    assert.ok(
      SOURCE.includes("translateResourceToToolCall"),
      "must delegate URI → tool call mapping to the translator",
    );
  });
});

// ---------------------------------------------------------------------------
// Translator behaviour — pure, testable without server-only.
// This is where rev 3.3's field mapping lives.
// ---------------------------------------------------------------------------

const TARGET_USER = "00000000-0000-4000-a000-000000000001";

describe("translator — omega://events/write field mapping (rev 3.3)", () => {
  it("maps envelope → buddy_ledger_write arguments field-by-field", () => {
    const call = translateResourceToToolCall(
      "omega://events/write",
      {
        type: "buddy.deal.ignited",
        entities: [
          { entity_type: "deal", id: "deal-abc" },
          { entity_type: "document", id: "doc-xyz" },
        ],
        payload: { foo: "bar" },
        ts: "2026-04-23T00:00:00Z",
        correlationId: "corr-123",
      },
      TARGET_USER,
    );

    assert.ok(call, "must return a ToolCall");
    assert.equal(call.tool, "buddy_ledger_write");
    assert.equal(call.arguments.target_user_id, TARGET_USER);
    assert.equal(call.arguments.event_type, "buddy.deal.ignited");
    assert.equal(call.arguments.status, "success");
    assert.equal(call.arguments.deal_id, "deal-abc");

    const wrapped = call.arguments.payload as {
      entities: unknown[];
      body: unknown;
      ts: string;
      correlationId: string;
    };
    assert.deepEqual(wrapped.body, { foo: "bar" });
    assert.equal(wrapped.entities.length, 2);
    assert.equal(wrapped.ts, "2026-04-23T00:00:00Z");
    assert.equal(wrapped.correlationId, "corr-123");
  });

  it("extracts deal_id from an underwriting_case entity too", () => {
    const call = translateResourceToToolCall(
      "omega://events/write",
      {
        type: "buddy.case.updated",
        entities: [{ entity_type: "underwriting_case", id: "case-42" }],
        payload: {},
      },
      TARGET_USER,
    );
    assert.ok(call);
    assert.equal(call.arguments.deal_id, "case-42");
  });

  it("omits deal_id entirely when no deal/underwriting_case entity present", () => {
    const call = translateResourceToToolCall(
      "omega://events/write",
      {
        type: "buddy.examiner.drop",
        entities: [{ entity_type: "examiner_drop", id: "drop-1" }],
        payload: {},
      },
      TARGET_USER,
    );
    assert.ok(call);
    assert.ok(
      !Object.prototype.hasOwnProperty.call(call.arguments, "deal_id"),
      "deal_id must be genuinely absent, not null or empty string",
    );
  });

  it("throws omega_write_missing_event_type when envelope.type is missing", () => {
    assert.throws(
      () =>
        translateResourceToToolCall(
          "omega://events/write",
          { entities: [], payload: {} },
          TARGET_USER,
        ),
      /omega_write_missing_event_type/,
    );
  });

  it("omits target_user_id when env var is unset", () => {
    const call = translateResourceToToolCall(
      "omega://events/write",
      { type: "buddy.ping", entities: [], payload: {} },
      undefined,
    );
    assert.ok(call);
    assert.ok(
      !Object.prototype.hasOwnProperty.call(call.arguments, "target_user_id"),
      "target_user_id must be absent when env unset",
    );
  });

  it("DEAL_ENTITY_TYPES contains deal and underwriting_case", () => {
    assert.ok(DEAL_ENTITY_TYPES.has("deal"));
    assert.ok(DEAL_ENTITY_TYPES.has("underwriting_case"));
    assert.ok(!DEAL_ENTITY_TYPES.has("document"));
    assert.ok(!DEAL_ENTITY_TYPES.has("borrower"));
  });
});

describe("translator — omega://health/ping (rev 3.1 health wiring)", () => {
  it("maps to mcp_tick with zero arguments and no target_user_id", () => {
    const call = translateResourceToToolCall(
      "omega://health/ping",
      undefined,
      TARGET_USER,
    );
    assert.ok(call);
    assert.equal(call.tool, "mcp_tick");
    assert.deepEqual(call.arguments, {});
  });
});

describe("translator — read-path kill-switch", () => {
  it("returns null for each read resource prefix", () => {
    for (const resource of [
      "omega://state/underwriting_case/xyz",
      "omega://state/borrower/abc",
      "omega://confidence/evaluate",
      "omega://traces/session-1",
      "omega://advisory/deal-focus",
    ]) {
      const call = translateResourceToToolCall(resource, {}, TARGET_USER);
      assert.equal(call, null, `${resource} must translate to null (kill-switch)`);
      assert.equal(isReadResource(resource), true, `${resource} must be flagged as read`);
    }
  });

  it("isReadResource is false for write, health, and unknown resources", () => {
    assert.equal(isReadResource("omega://events/write"), false);
    assert.equal(isReadResource("omega://health/ping"), false);
    assert.equal(isReadResource("omega://frobnicate/whatever"), false);
  });
});

describe("translator — unmapped resources", () => {
  it("returns null for unknown URI (caller distinguishes via isReadResource)", () => {
    const call = translateResourceToToolCall(
      "omega://frobnicate/whatever",
      {},
      TARGET_USER,
    );
    assert.equal(call, null);
    assert.equal(isReadResource("omega://frobnicate/whatever"), false);
  });
});

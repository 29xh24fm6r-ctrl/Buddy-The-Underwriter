import test from "node:test";
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

/**
 * SPEC-BIE-PRIVATE-COMPANY-RESEARCH-ENGINE-MEGA-1 — Phase 1 diagnostics.
 * Every BIE thread failure mode must be captured (never a silent null).
 */

mockServerOnly();
const require_ = createRequire(import.meta.url);
const bie = require_("@/lib/research/buddyIntelligenceEngine") as typeof import("@/lib/research/buddyIntelligenceEngine");
const { callGeminiGrounded, describeThreadDiagnostic } = bie;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function mockFetch(impl: () => any) {
  globalThis.fetch = (async () => impl()) as any;
}
const call = (over: Partial<Parameters<typeof callGeminiGrounded>[0]> = {}) =>
  callGeminiGrounded({ prompt: "p", apiKey: "k", sources: [], logTag: "t", thread: "management", useGrounding: false, ...over });

describe("callGeminiGrounded diagnostics", () => {
  it("non-200 → http_error with status + preview", async () => {
    mockFetch(() => ({ ok: false, status: 429, text: async () => "rate limited", json: async () => ({}) }));
    const r = await call();
    assert.equal(r.result, null);
    assert.equal(r.diagnostic.ok, false);
    assert.equal(r.diagnostic.error_type, "http_error");
    assert.equal(r.diagnostic.http_status, 429);
    assert.match(r.diagnostic.raw_text_preview ?? "", /rate limited/);
  });

  it("no candidate → empty_candidate", async () => {
    mockFetch(() => ({ ok: true, status: 200, json: async () => ({ candidates: [] }) }));
    const r = await call();
    assert.equal(r.diagnostic.error_type, "empty_candidate");
  });

  it("prompt blocked → safety_block", async () => {
    mockFetch(() => ({ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: "SAFETY" } }) }));
    const r = await call();
    assert.equal(r.diagnostic.error_type, "safety_block");
    assert.equal(r.diagnostic.prompt_block_reason, "SAFETY");
  });

  it("candidate with empty text → empty_text", async () => {
    mockFetch(() => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP" }] }) }));
    const r = await call();
    assert.equal(r.diagnostic.error_type, "empty_text");
  });

  it("finishReason SAFETY with no text → safety_block", async () => {
    mockFetch(() => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] }) }));
    const r = await call();
    assert.equal(r.diagnostic.error_type, "safety_block");
    assert.equal(r.diagnostic.finish_reason, "SAFETY");
  });

  it("invalid JSON → json_parse_error with preview", async () => {
    mockFetch(() => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "not json {" }] }, finishReason: "STOP" }] }) }));
    const r = await call();
    assert.equal(r.diagnostic.error_type, "json_parse_error");
    assert.ok((r.diagnostic.json_parse_error ?? "").length > 0);
    assert.match(r.diagnostic.raw_text_preview ?? "", /not json/);
  });

  it("network throw → network_error", async () => {
    globalThis.fetch = (async () => { throw new Error("ECONNRESET"); }) as any;
    const r = await call();
    assert.equal(r.diagnostic.error_type, "network_error");
    assert.match(r.diagnostic.json_parse_error ?? "", /ECONNRESET/);
  });

  it("valid JSON → ok, result unchanged, diagnostic ok", async () => {
    mockFetch(() => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"hello":"world"}' }] }, finishReason: "STOP" }] }) }));
    const r = await call();
    assert.deepEqual(r.result, { hello: "world" });
    assert.equal(r.diagnostic.ok, true);
    assert.equal(r.diagnostic.error_type, "none");
    assert.equal(r.diagnostic.thread, "management");
  });
});

describe("describeThreadDiagnostic", () => {
  it("renders readable reasons", () => {
    assert.match(describeThreadDiagnostic({ thread: "synthesis", ok: false, error_type: "json_parse_error", json_parse_error: "Unexpected token", raw_text_preview: "{bad", prompt_chars: 10, source_count: 0, model: "m", created_at: "t" } as any), /Synthesis failed: invalid JSON/);
    assert.match(describeThreadDiagnostic({ thread: "management", ok: false, error_type: "http_error", http_status: 429, prompt_chars: 10, source_count: 0, model: "m", created_at: "t" } as any), /Management failed: HTTP 429/);
    assert.match(describeThreadDiagnostic({ thread: "synthesis", ok: false, error_type: "empty_candidate", prompt_chars: 0, source_count: 0, model: "m", created_at: "t" } as any), /empty model response/);
  });
});

describe("persistence + UI wiring", () => {
  it("migration adds thread_diagnostics column", () => {
    assert.match(read("supabase/migrations/20260602_research_thread_diagnostics.sql"), /thread_diagnostics jsonb/);
  });
  it("runMission persists thread_diagnostics on the mission row", () => {
    const src = read("src/lib/research/runMission.ts");
    assert.match(src, /thread_diagnostics: bieResult\.thread_diagnostics/);
  });
  it("BIEResult carries thread_diagnostics for every thread", () => {
    const src = read("src/lib/research/buddyIntelligenceEngine.ts");
    assert.match(src, /thread_diagnostics: Record<BIEThreadName, BIEThreadDiagnostic>/);
  });
  it("flight-deck surfaces a readable diagnostic for failed threads", () => {
    const src = read("src/app/api/deals/[dealId]/research/[action]/_handlers/flight-deck.ts");
    assert.match(src, /describeThreadDiagnostic/);
    assert.match(src, /thread_diagnostics/);
  });
});

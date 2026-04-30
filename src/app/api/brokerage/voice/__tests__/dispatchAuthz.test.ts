import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

// ─── Mock state ────────────────────────────────────────────────────────
type Row = Record<string, any>;
const state: {
  sessions: Row[];
  concierge: Row[];
  audits: Row[];
  extractResult: Record<string, unknown> | null;
} = {
  sessions: [],
  concierge: [],
  audits: [],
  extractResult: null,
};

function resetState() {
  state.sessions = [];
  state.concierge = [];
  state.audits = [];
  state.extractResult = null;
}

function makeQueryBuilder(tableName: string) {
  const q: any = {
    _filters: [] as Array<[string, any]>,
    _isNull: [] as string[],
    _op: "select" as "select" | "insert" | "update",
    _updatePayload: null as any,
    _insertPayload: null as any,
    select() {
      return this;
    },
    eq(col: string, val: any) {
      this._filters.push([col, val]);
      return this;
    },
    is(col: string, _v: null) {
      this._isNull.push(col);
      return this;
    },
    insert(payload: any) {
      this._op = "insert";
      this._insertPayload = payload;
      return this;
    },
    update(payload: any) {
      this._op = "update";
      this._updatePayload = payload;
      return this;
    },
    maybeSingle() {
      const rows = this._exec();
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    then(onFulfilled: any) {
      const rows = this._exec();
      return Promise.resolve({ data: rows, error: null }).then(onFulfilled);
    },
    _exec(): Row[] {
      const source = ({
        deal_voice_sessions: state.sessions,
        borrower_concierge_sessions: state.concierge,
        voice_session_audits: state.audits,
      } as Record<string, Row[]>)[tableName];
      if (!source) return [];
      if (this._op === "insert") {
        const list = Array.isArray(this._insertPayload)
          ? this._insertPayload
          : [this._insertPayload];
        for (const p of list) source.push({ ...p });
        return list;
      }
      let filtered = source.filter((row) =>
        this._filters.every(([k, v]: [string, any]) => row[k] === v),
      );
      for (const col of this._isNull) {
        filtered = filtered.filter((row) => row[col] == null);
      }
      if (this._op === "update") {
        for (const row of filtered) Object.assign(row, this._updatePayload);
        return filtered;
      }
      return filtered;
    },
  };
  return q;
}

const supabaseStub = {
  from(t: string) {
    return makeQueryBuilder(t);
  },
  rpc() {
    return Promise.resolve({ data: null, error: null });
  },
};

require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "sb-stub",
  filename: "sb-stub",
  loaded: true,
  exports: { supabaseAdmin: () => supabaseStub },
} as any;

require.cache[require.resolve("@/lib/ai/geminiClient")] = {
  id: "gemini-stub",
  filename: "gemini-stub",
  loaded: true,
  exports: {
    callGeminiJSON: async () => ({
      ok: state.extractResult != null,
      result: state.extractResult,
      latencyMs: 1,
      attempts: 1,
    }),
  },
} as any;

process.env.BUDDY_GATEWAY_SECRET = "test-secret";

// Load the route under test.
const { POST } =
  require("../[sessionId]/dispatch/route") as typeof import("../[sessionId]/dispatch/route");

function mkReq(headers: Record<string, string>, body: unknown): any {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: async () => body,
  };
}

async function call(
  sessionId: string,
  secret: string | null,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (secret !== null) headers["x-gateway-secret"] = secret;
  const res = await POST(mkReq(headers, body), {
    params: Promise.resolve({ sessionId }),
  });
  return { status: res.status, body: await res.json() };
}

// ─── Tests ────────────────────────────────────────────────────────────

test("missing x-gateway-secret → 401", async () => {
  resetState();
  const r = await call("s1", null, {
    intent: "utterance",
    speaker: "borrower",
    text: "hi",
  });
  assert.equal(r.status, 401);
});

test("wrong secret → 401", async () => {
  resetState();
  const r = await call("s1", "not-the-secret", {
    intent: "utterance",
    speaker: "borrower",
    text: "hi",
  });
  assert.equal(r.status, 401);
});

test("banker-scoped session on brokerage dispatch → 400 wrong_actor_scope", async () => {
  resetState();
  state.sessions.push({
    id: "banker-1",
    actor_scope: "banker",
    deal_id: "d",
    bank_id: "b",
    user_id: "u",
    borrower_session_token_hash: null,
    borrower_concierge_session_id: null,
  });
  const r = await call("banker-1", "test-secret", {
    intent: "utterance",
    speaker: "borrower",
    text: "hi",
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "wrong_actor_scope");
});

test("session not found → 404", async () => {
  resetState();
  const r = await call("nope", "test-secret", {
    intent: "utterance",
    speaker: "borrower",
    text: "hi",
  });
  assert.equal(r.status, 404);
});

test("borrower utterance: conversation_history appended with channel='voice' + utterance_borrower audit written", async () => {
  resetState();
  state.concierge.push({
    id: "c1",
    conversation_history: [],
    confirmed_facts: {},
  });
  state.sessions.push({
    id: "s1",
    actor_scope: "borrower",
    deal_id: "d",
    bank_id: "b",
    user_id: null,
    borrower_session_token_hash: "h",
    borrower_concierge_session_id: "c1",
  });
  const r = await call("s1", "test-secret", {
    intent: "utterance",
    speaker: "borrower",
    text: "I need 280K for buildout",
  });
  assert.equal(r.status, 200);
  const history = state.concierge[0].conversation_history;
  assert.equal(history.length, 1);
  assert.equal(history[0].channel, "voice");
  assert.equal(history[0].role, "user");
  assert.ok(
    state.audits.some(
      (a) =>
        a.event_type === "utterance_borrower" && a.actor_scope === "borrower",
    ),
  );
});

test("borrower utterance with extractable facts: confirmed_facts merged + fact_extracted audit", async () => {
  resetState();
  state.concierge.push({
    id: "c1",
    conversation_history: [],
    confirmed_facts: { business_type: "prior" },
  });
  state.sessions.push({
    id: "s1",
    actor_scope: "borrower",
    deal_id: "d",
    bank_id: "b",
    user_id: null,
    borrower_session_token_hash: "h",
    borrower_concierge_session_id: "c1",
  });
  state.extractResult = {
    loan_amount_requested: 280000,
    business_location_city: "Madison",
  };
  await call("s1", "test-secret", {
    intent: "utterance",
    speaker: "borrower",
    text: "coffee shop in Madison Wisconsin, 280K buildout",
  });
  assert.deepEqual(state.concierge[0].confirmed_facts, {
    business_type: "prior",
    loan_amount_requested: 280000,
    business_location_city: "Madison",
  });
  assert.ok(
    state.audits.some(
      (a) =>
        a.event_type === "fact_extracted" &&
        Array.isArray(a.payload?.keys) &&
        a.payload.keys.includes("loan_amount_requested"),
    ),
  );
});

test("S2-2: client-injected tool_call → tool_call audit ONLY; confirmed_facts NOT mutated", async () => {
  resetState();
  state.concierge.push({
    id: "c1",
    conversation_history: [],
    confirmed_facts: {},
  });
  state.sessions.push({
    id: "s1",
    actor_scope: "borrower",
    deal_id: "d",
    bank_id: "b",
    user_id: null,
    borrower_session_token_hash: "h",
    borrower_concierge_session_id: "c1",
  });
  await call("s1", "test-secret", {
    intent: "tool_call",
    toolName: "record_borrower_fact",
    args: { fico_estimate: 850 }, // attacker trying to inject a fake FICO
  });
  assert.deepEqual(
    state.concierge[0].confirmed_facts,
    {},
    "client-injected tool_call must NOT mutate confirmed_facts",
  );
  assert.equal(
    state.audits.filter((a) => a.event_type === "tool_call").length,
    1,
  );
  // No fact_extracted audit either.
  assert.equal(
    state.audits.filter((a) => a.event_type === "fact_extracted").length,
    0,
  );
});

test("session_ended intent marks session state='ended' + emits audit", async () => {
  resetState();
  state.sessions.push({
    id: "s1",
    actor_scope: "borrower",
    deal_id: "d",
    bank_id: "b",
    user_id: null,
    borrower_session_token_hash: "h",
    borrower_concierge_session_id: null,
    state: "active",
  });
  await call("s1", "test-secret", { intent: "session_ended" });
  assert.equal(state.sessions[0].state, "ended");
  assert.ok(
    state.audits.some((a) => a.event_type === "session_ended"),
  );
});

test("extraction filters out non-allowlisted keys (prompt-injection defense)", async () => {
  resetState();
  state.concierge.push({
    id: "c1",
    conversation_history: [],
    confirmed_facts: {},
  });
  state.sessions.push({
    id: "s1",
    actor_scope: "borrower",
    deal_id: "d",
    bank_id: "b",
    user_id: null,
    borrower_session_token_hash: "h",
    borrower_concierge_session_id: "c1",
  });
  // Attacker-controlled utterance tricks Gemini into emitting
  // non-allowed keys in addition to a legitimate one.
  state.extractResult = {
    loan_amount_requested: 100000, // allowed
    admin_override: true, // not allowed
    bypass_checks: true, // not allowed
  };
  await call("s1", "test-secret", {
    intent: "utterance",
    speaker: "borrower",
    text: "I need a hundred thousand for the store",
  });
  const facts = state.concierge[0].confirmed_facts;
  assert.equal(facts.loan_amount_requested, 100000);
  assert.equal(
    "admin_override" in facts,
    false,
    "non-allowlisted keys must be filtered",
  );
  assert.equal("bypass_checks" in facts, false);
});

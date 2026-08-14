/**
 * SPEC-BORROWER-STRUCTURED-ASSUMPTIONS-1 — resolvePortalContext's
 * session-scoped fallback. This is the fix for the confirmed P0 bug where
 * every /api/borrower/portal/[token]/* route always 401'd for self-serve
 * /start borrowers (they pass their own dealId as `token`; there is no
 * borrower_invites row for the brokerage tenant — 0 in production).
 *
 * Same require.cache module-stub convention as
 * assumptionConfirmDeadendFix.test.ts / sessionToken.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

type Row = Record<string, any>;

const state: {
  invites: Row[];
  deals: Row[];
  session: { deal_id: string; bank_id: string } | null;
} = { invites: [], deals: [], session: null };

function resetState() {
  state.invites = [];
  state.deals = [];
  state.session = null;
}

function makeQueryBuilder(tableName: string) {
  const q: any = {
    _filters: [] as Array<[string, any]>,
    select() {
      return this;
    },
    eq(col: string, val: any) {
      this._filters.push([col, val]);
      return this;
    },
    maybeSingle() {
      const rows: Row[] =
        tableName === "borrower_invites"
          ? state.invites
          : tableName === "deals"
            ? state.deals
            : [];
      const match = rows.find((r) =>
        this._filters.every(([col, val]: [string, any]) => r[col] === val),
      );
      return Promise.resolve({ data: match ?? null, error: null });
    },
  };
  return q;
}

const supabaseStub = { from: (t: string) => makeQueryBuilder(t) };

require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "sb-stub",
  filename: "sb-stub",
  loaded: true,
  exports: { supabaseAdmin: () => supabaseStub },
} as any;

require.cache[require.resolve("@/lib/brokerage/sessionToken")] = {
  id: "session-stub",
  filename: "session-stub",
  loaded: true,
  exports: {
    getBorrowerSession: async () => state.session,
  },
} as any;

const { resolvePortalContext } =
  require("../resolvePortalContext") as typeof import("../resolvePortalContext");

// ─── Primary path: admin-issued invite token — unchanged behavior ────────

test("invite token: resolves via borrower_invites hash lookup (bank/examiner flow, unaffected)", async () => {
  resetState();
  const { sha256Base64url } = require("@/lib/portal/token") as typeof import("@/lib/portal/token");
  const raw = "some-invite-token";
  state.invites = [
    { token_hash: sha256Base64url(raw), deal_id: "deal-invited", bank_id: "bank-x", expires_at: null, revoked_at: null },
  ];
  const ctx = await resolvePortalContext(raw);
  assert.equal(ctx.dealId, "deal-invited");
  assert.equal(ctx.bankId, "bank-x");
});

test("invite token: revoked invite still throws (fallback must not silently override a revoked invite)", async () => {
  resetState();
  const { sha256Base64url } = require("@/lib/portal/token") as typeof import("@/lib/portal/token");
  const raw = "revoked-token";
  state.invites = [
    { token_hash: sha256Base64url(raw), deal_id: "deal-x", bank_id: "bank-x", expires_at: null, revoked_at: "2026-01-01T00:00:00Z" },
  ];
  await assert.rejects(() => resolvePortalContext(raw), /revoked/i);
});

// ─── Fallback path: self-serve borrower session ───────────────────────────

test("session fallback: a raw deal id resolves when the session cookie is bound to that EXACT deal", async () => {
  resetState();
  state.session = { deal_id: "deal-123", bank_id: "bank-abc" };
  state.deals = [{ id: "deal-123", bank_id: "bank-abc" }];
  const ctx = await resolvePortalContext("deal-123");
  assert.equal(ctx.dealId, "deal-123");
  assert.equal(ctx.bankId, "bank-abc");
});

test("session fallback: REJECTS when the token doesn't match the session's own deal (no cross-deal access)", async () => {
  resetState();
  state.session = { deal_id: "deal-123", bank_id: "bank-abc" };
  state.deals = [{ id: "deal-999", bank_id: "bank-abc" }]; // a different deal exists
  await assert.rejects(() => resolvePortalContext("deal-999"), /invalid portal token/i);
});

test("session fallback: REJECTS when there is no session at all (no cookie, no invite)", async () => {
  resetState();
  state.session = null;
  await assert.rejects(() => resolvePortalContext("deal-123"), /invalid portal token/i);
});

test("session fallback: never fires when a valid invite already matched (invite path takes priority)", async () => {
  resetState();
  const { sha256Base64url } = require("@/lib/portal/token") as typeof import("@/lib/portal/token");
  const raw = "invite-and-session-both-present";
  state.invites = [
    { token_hash: sha256Base64url(raw), deal_id: "deal-from-invite", bank_id: "bank-invite", expires_at: null, revoked_at: null },
  ];
  // Session is bound to a DIFFERENT deal — if the invite path is skipped
  // in favor of the fallback, this would wrongly resolve to deal-from-invite
  // only by coincidence. Assert it resolves via the invite, not the session.
  state.session = { deal_id: "deal-from-session", bank_id: "bank-session" };
  const ctx = await resolvePortalContext(raw);
  assert.equal(ctx.dealId, "deal-from-invite");
});

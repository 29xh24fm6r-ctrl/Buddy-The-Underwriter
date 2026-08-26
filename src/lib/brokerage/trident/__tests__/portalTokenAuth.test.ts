import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { resolvePortalToken } =
  require("../portalTokenAuth") as typeof import("../portalTokenAuth");

/**
 * Portal-token resolution is the ONLY gate in front of every borrower-portal
 * Trident surface: preview generation, latest-preview, and the signed download
 * of the business plan, projections, and feasibility study.
 *
 * Audit F-08: it checked `expires_at` alone. SPEC-BROKERAGE-LAUNCH-BLOCKERS-V1
 * §3.3 added `borrower_portal_links.revoked_at` precisely so a leaked or
 * superseded link can be killed ahead of its expiry, and the sibling resolver
 * in /api/borrower/resolve already honours it — but a revoked link still
 * resolved here, so revocation was unenforceable on the Trident surface.
 */

type Link = {
  deal_id: string;
  expires_at: string | null;
  revoked_at: string | null;
};

/** Minimal client exposing only what resolvePortalToken uses. */
function clientReturning(link: Link | null) {
  const selected: string[] = [];
  const client = {
    selectedColumns: () => selected,
    from(_table: string) {
      return {
        select(columns: string) {
          selected.push(columns);
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: link, error: null });
        },
      };
    },
  };
  return client;
}

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

test("a live link resolves to its deal", async () => {
  const ctx = await resolvePortalToken(
    "tok-live",
    clientReturning({ deal_id: "deal-1", expires_at: FUTURE, revoked_at: null }) as any,
  );
  assert.deepEqual(ctx, { token: "tok-live", dealId: "deal-1" });
});

test("a link with no expiry resolves", async () => {
  const ctx = await resolvePortalToken(
    "tok-noexp",
    clientReturning({ deal_id: "deal-1", expires_at: null, revoked_at: null }) as any,
  );
  assert.equal(ctx?.dealId, "deal-1");
});

test("a REVOKED link is rejected even while unexpired", async () => {
  const ctx = await resolvePortalToken(
    "tok-revoked",
    clientReturning({ deal_id: "deal-1", expires_at: FUTURE, revoked_at: PAST }) as any,
  );
  assert.equal(ctx, null, "a revoked portal link must not reach any Trident surface");
});

test("a revoked link with no expiry is still rejected", async () => {
  const ctx = await resolvePortalToken(
    "tok-revoked-noexp",
    clientReturning({ deal_id: "deal-1", expires_at: null, revoked_at: PAST }) as any,
  );
  assert.equal(ctx, null);
});

test("revocation is read from the database, not inferred", async () => {
  const client = clientReturning({
    deal_id: "deal-1",
    expires_at: FUTURE,
    revoked_at: null,
  });
  await resolvePortalToken("tok-columns", client as any);
  assert.ok(
    client.selectedColumns().some((columns) => columns.includes("revoked_at")),
    "resolvePortalToken must select revoked_at or it cannot enforce revocation",
  );
});

test("an expired link is rejected", async () => {
  const ctx = await resolvePortalToken(
    "tok-expired",
    clientReturning({ deal_id: "deal-1", expires_at: PAST, revoked_at: null }) as any,
  );
  assert.equal(ctx, null);
});

test("an unknown token is rejected", async () => {
  const ctx = await resolvePortalToken("tok-missing", clientReturning(null) as any);
  assert.equal(ctx, null);
});

test("an empty token is rejected without a lookup", async () => {
  assert.equal(await resolvePortalToken("", clientReturning(null) as any), null);
  assert.equal(
    await resolvePortalToken(undefined as unknown as string, clientReturning(null) as any),
    null,
  );
});

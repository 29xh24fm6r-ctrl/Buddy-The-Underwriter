import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
let databaseError: Error | null = null;
const filters: Array<[string, unknown]> = [];
const sb = {
  from(table: string) {
    assert.equal(table, "deal_timeline_events");
    const query = {
      select(columns: string) {
        assert.equal(columns, "id, kind, title, detail, created_at");
        return query;
      },
      eq(column: string, value: unknown) { filters.push([column, value]); return query; },
      order() { return query; },
      async limit() { return { error: databaseError, data: [{
        id: "receipt-event", kind: "doc_received", title: "Bank received: Document received",
        detail: "budget.pdf", created_at: "2026-09-21T00:00:00Z",
      }] }; },
    };
    return query;
  },
};
require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "sb", filename: "sb", loaded: true, exports: { supabaseAdmin: () => sb },
} as any;
require.cache[require.resolve("@/lib/portal/resolveBorrowerToken")] = {
  id: "auth", filename: "auth", loaded: true,
  exports: { resolveBorrowerToken: async () => ({ deal_id: "authorized-deal" }) },
} as any;
const { GET } = require("../../../app/api/portal/[token]/activity/route") as typeof import("../../../app/api/portal/[token]/activity/route");

test("activity uses canonical columns and scopes borrower-visible events to the authorized deal", async () => {
  filters.length = 0;
  databaseError = null;
  const response = await GET(new Request("https://example.test"), { params: Promise.resolve({ token: "test" }) });
  assert.equal(response.status, 200);
  assert.deepEqual(filters, [["deal_id", "authorized-deal"], ["visible_to_borrower", true]]);
  const body = await response.json();
  assert.equal(body.activities[0].kind, "upload");
  assert.equal(body.activities[0].title, "Buddy received your document");
});

test("an activity read failure is not reported as an empty successful feed", async () => {
  databaseError = new Error("database unavailable");
  const response = await GET(new Request("https://example.test"), { params: Promise.resolve({ token: "test" }) });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).ok, false);
});

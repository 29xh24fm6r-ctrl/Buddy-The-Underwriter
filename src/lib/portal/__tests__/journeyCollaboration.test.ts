import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
let session = { deal_id: "mine", bank_id: "bank" };
let minted = 0;
const items = [
  {
    id: "business",
    deal_id: "mine",
    code: "IRS_BUSINESS_3Y",
    title: "Business returns",
  },
  {
    id: "personal",
    deal_id: "mine",
    code: "PFS_CURRENT",
    title: "Personal financial statement",
  },
  {
    id: "foreign",
    deal_id: "foreign",
    code: "IRS_BUSINESS_3Y",
    title: "Other business",
  },
];
const links = [
  {
    id: "link",
    deal_id: "mine",
    token: "never-return-this",
    recipient_name: "Accountant",
    revoked: false,
  },
];
function mock(path: string, exports: unknown) {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports } as any;
}
mock("@/lib/brokerage/sessionToken", {
  getBorrowerSession: async () => session,
});
mock("@/lib/portal/auth", {
  bearerToken: (s: string) => s,
  requireInviteForDeal: async () => {
    throw new Error("Unauthorized");
  },
});
mock("@/lib/portal/shareLinks", {
  createShareLink: async () => {
    minted++;
    return { id: "new-link", token: "scoped-token", expires_at: "2026-09-24" };
  },
});
mock("@/lib/supabase/admin", {
  supabaseAdmin: () => ({
    from(table: string) {
      let result: any[] =
        table === "deal_portal_checklist_items" ? [...items] : [...links];
      let patch: any;
      let columns: string[] = [];
      const finish = () => {
        if (patch) result.forEach((r) => Object.assign(r, patch));
        return result.map((r) =>
          Object.fromEntries(columns.map((c) => [c, r[c]])),
        );
      };
      const q: any = {
        select: (s: string) => {
          columns = s.split(",").map((s) => s.trim());
          return q;
        },
        eq: (k: string, v: any) => {
          result = result.filter((r) => r[k] === v);
          return q;
        },
        in: (k: string, v: any[]) => {
          result = result.filter((r) => v.includes(r[k]));
          return q;
        },
        order: () => q,
        limit: () => q,
        update: (p: any) => {
          patch = p;
          return q;
        },
        maybeSingle: async () => ({ data: finish()[0] ?? null, error: null }),
        then: (res: any) =>
          Promise.resolve({ data: finish(), error: null }).then(res),
      };
      return q;
    },
  }),
});
const { GET, POST, DELETE } =
  require("@/app/api/portal/deals/[dealId]/share-links/route") as typeof import("@/app/api/portal/deals/[dealId]/share-links/route");
const ctx = (dealId = "mine") => ({ params: Promise.resolve({ dealId }) });
const req = (body: unknown = {}) =>
  new Request("https://example.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
test("helper sharing exposes only business request choices, verifies scope before minting and permits revocation only on own deal", async () => {
  const result = await (await GET(req(), ctx())).json();
  assert.deepEqual(
    result.items.map((i: any) => i.id),
    ["business"],
  );
  assert.ok(!JSON.stringify(result).includes("never-return-this"));
  assert.equal((await GET(req(), ctx("foreign"))).status, 404);
  for (const checklistItemIds of [
    ["personal"],
    ["foreign"],
    ["business", "business"],
  ]) {
    assert.equal(
      (
        await POST(
          req({
            purpose: "business_financials",
            confirmed: true,
            checklistItemIds,
          }),
          ctx(),
        )
      ).status,
      400,
    );
  }
  assert.equal(minted, 0);
  assert.equal(
    (
      await POST(
        req({
          purpose: "business_financials",
          confirmed: false,
          checklistItemIds: ["business"],
        }),
        ctx(),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await POST(
        req({
          purpose: "business_financials",
          confirmed: true,
          checklistItemIds: ["business"],
          recipientName: "Accountant",
        }),
        ctx(),
      )
    ).status,
    200,
  );
  assert.equal(minted, 1);
  assert.equal((await DELETE(req({ id: "link" }), ctx("foreign"))).status, 404);
  assert.equal(links[0].revoked, false);
  assert.equal((await DELETE(req({ id: "link" }), ctx())).status, 200);
  assert.equal(links[0].revoked, true);
  session = { deal_id: "other", bank_id: "bank" };
  assert.equal(
    (await POST(req({ checklistItemIds: ["business"] }), ctx())).status,
    400,
  );
  assert.equal(minted, 1);
});

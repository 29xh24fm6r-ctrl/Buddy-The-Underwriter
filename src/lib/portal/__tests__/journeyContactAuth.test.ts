import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
let session: { deal_id: string; bank_id: string } | null = null;
let reads = 0;
let invite = false;
function mock(path: string, exports: unknown) {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports } as any;
}
mock("@/lib/brokerage/sessionToken", {
  getBorrowerSession: async () => session,
});
mock("@/lib/portal/resolveBorrowerToken", {
  resolveBorrowerToken: async () => {
    if (!invite) throw new Error("invalid");
    return {
      deal_id: "invited-deal",
      bank_id: "bank",
      name: null,
      email: null,
      source: "invite",
    };
  },
});
mock("@/lib/auth/clerkServer", { clerkClient: async () => null });
mock("@/lib/supabase/admin", {
  supabaseAdmin: () => ({
    from(table: string) {
      reads++;
      const data =
        table === "deals"
          ? { id: session?.deal_id ?? "invited-deal", bank_id: "bank" }
          : table === "deal_participants"
            ? []
            : null;
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        maybeSingle: async () => ({ data, error: null }),
        then: (resolve: any) =>
          Promise.resolve({ data, error: null }).then(resolve),
      };
      return q;
    },
  }),
});
const { GET } =
  require("@/app/api/portal/[token]/context/route") as typeof import("@/app/api/portal/[token]/context/route");
const call = (token: string) =>
  GET(new Request("https://example.test"), {
    params: Promise.resolve({ token }),
  });
test("contact lookup accepts the exact borrower session, denies foreign and anonymous deal IDs, retains valid invite access", async () => {
  session = { deal_id: "mine", bank_id: "bank" };
  assert.equal((await call("mine")).status, 200);
  reads = 0;
  assert.equal((await call("foreign")).status, 404);
  assert.equal(reads, 0);
  session = null;
  assert.equal((await call("mine")).status, 404);
  assert.equal(reads, 0);
  invite = true;
  assert.equal((await call("opaque-invite")).status, 200);
});

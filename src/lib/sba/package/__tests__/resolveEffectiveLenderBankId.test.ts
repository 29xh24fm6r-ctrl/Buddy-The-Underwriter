import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEffectiveLenderBankId } from "@/lib/sba/package/resolveEffectiveLenderBankId";

function makeSb(pick: { picked_lender_bank_id: string } | null) {
  return {
    from(table: string) {
      const q: any = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle() {
          if (table === "marketplace_picks") return Promise.resolve({ data: pick, error: null });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return q;
    },
  } as any;
}

test("resolveEffectiveLenderBankId: falls back to the deal's own bank_id when no pick exists (Underwriter tenant, or Brokerage pre-pick)", async () => {
  const sb = makeSb(null);
  const result = await resolveEffectiveLenderBankId("deal-1", "bank-underwriter", sb);
  assert.equal(result, "bank-underwriter");
});

test("resolveEffectiveLenderBankId: resolves the picked lender's bank_id once a Brokerage deal has been picked", async () => {
  const sb = makeSb({ picked_lender_bank_id: "bank-picked-lender" });
  const result = await resolveEffectiveLenderBankId("deal-1", "bank-brokerage-tenant", sb);
  assert.equal(result, "bank-picked-lender");
});

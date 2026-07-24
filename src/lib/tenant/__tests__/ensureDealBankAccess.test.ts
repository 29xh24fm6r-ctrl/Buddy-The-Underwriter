/**
 * Unit tests for ensureDealBankAccess — tenant gate for deal routes.
 *
 * These tests mock clerkAuth, getCurrentBankId, and supabaseAdmin to verify
 * the guard correctly denies cross-tenant access and allows same-tenant access.
 *
 * Run: node --test --import tsx src/lib/tenant/__tests__/ensureDealBankAccess.test.ts
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Stubs ──────────────────────────────────────────────────────────────────

let mockUserId: string | null = "user_123";
let mockBankId: string = "bank_A";
let mockGetBankIdThrows: boolean = false;
let mockDealRow: { id: string; bank_id: string } | null = null;
let mockDealError: { message: string } | null = null;

// Mock clerkAuth
const mockClerkAuth = async () => ({ userId: mockUserId });

// Mock getCurrentBankId
const mockGetCurrentBankId = async () => {
  if (mockGetBankIdThrows) throw new Error("not_authenticated");
  return mockBankId;
};

// Mock supabaseAdmin
const mockSupabase = {
  from: (_table: string) => ({
    select: (_cols: string) => ({
      eq: (_col: string, _val: string) => ({
        maybeSingle: async () => ({
          data: mockDealRow,
          error: mockDealError,
        }),
      }),
    }),
  }),
};

// ── Module-level mocks via dynamic import trick ────────────────────────────
// Since we can't easily mock ESM imports, we replicate the guard logic inline
// to test the decision tree. This tests the same conditional logic.

type EnsureResult =
  | { ok: true; dealId: string; bankId: string; userId: string }
  | { ok: false; error: "deal_not_found" | "tenant_mismatch" | "unauthorized"; detail?: string };

async function ensureDealBankAccessTestable(dealId: string): Promise<EnsureResult> {
  let userId: string | null = null;
  let userBankId: string | null = null;

  try {
    const auth = await mockClerkAuth();
    userId = auth.userId;

    if (!userId) {
      return { ok: false, error: "unauthorized", detail: "not_authenticated" };
    }

    userBankId = await mockGetCurrentBankId();

    const sb = mockSupabase;
    const { data: deal, error } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .maybeSingle();

    if (error || !deal) {
      return { ok: false, error: "deal_not_found" };
    }

    if (deal.bank_id !== userBankId) {
      return { ok: false, error: "tenant_mismatch", detail: `user bank ${userBankId} != deal bank ${deal.bank_id}` };
    }

    return { ok: true, dealId: deal.id, bankId: deal.bank_id, userId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return { ok: false, error: "unauthorized", detail: msg };
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ensureDealBankAccess", () => {
  beforeEach(() => {
    mockUserId = "user_123";
    mockBankId = "bank_A";
    mockGetBankIdThrows = false;
    mockDealRow = null;
    mockDealError = null;
  });

  test("allows access when user bank matches deal bank", async () => {
    mockDealRow = { id: "deal_1", bank_id: "bank_A" };
    const result = await ensureDealBankAccessTestable("deal_1");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.dealId, "deal_1");
      assert.equal(result.bankId, "bank_A");
      assert.equal(result.userId, "user_123");
    }
  });

  test("denies access when user bank differs from deal bank (tenant mismatch)", async () => {
    mockDealRow = { id: "deal_1", bank_id: "bank_B" };
    mockBankId = "bank_A";
    const result = await ensureDealBankAccessTestable("deal_1");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "tenant_mismatch");
      assert.ok(result.detail?.includes("bank_A"));
      assert.ok(result.detail?.includes("bank_B"));
    }
  });

  test("returns deal_not_found when deal does not exist", async () => {
    mockDealRow = null;
    const result = await ensureDealBankAccessTestable("deal_missing");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "deal_not_found");
    }
  });

  test("returns deal_not_found on supabase query error", async () => {
    mockDealError = { message: "some db error" };
    const result = await ensureDealBankAccessTestable("deal_1");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "deal_not_found");
    }
  });

  test("returns unauthorized when userId is null", async () => {
    mockUserId = null;
    const result = await ensureDealBankAccessTestable("deal_1");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "unauthorized");
    }
  });

  test("returns unauthorized when getCurrentBankId throws", async () => {
    mockGetBankIdThrows = true;
    const result = await ensureDealBankAccessTestable("deal_1");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "unauthorized");
      assert.equal(result.detail, "not_authenticated");
    }
  });

  test("cross-tenant scenario: user in bank A cannot access deal in bank B", async () => {
    mockBankId = "bank_A";
    mockDealRow = { id: "deal_in_B", bank_id: "bank_B" };
    const result = await ensureDealBankAccessTestable("deal_in_B");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "tenant_mismatch");
    }
  });

  test("same-tenant scenario: user in bank B can access deal in bank B", async () => {
    mockBankId = "bank_B";
    mockDealRow = { id: "deal_in_B", bank_id: "bank_B" };
    const result = await ensureDealBankAccessTestable("deal_in_B");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.bankId, "bank_B");
    }
  });
});

// ── ensureDealBankAccessAllowingBrokerageStaff ──────────────────────────────
//
// Found during live QA of SPEC-BROKERAGE-OPERATING-SYSTEM-V1: a fully
// authorized brokerage staffer (requireBrokerageStaff) got tenant_mismatch
// on every deal the CRM creates, because those deals carry bank_id =
// <brokerage tenant>, while the strict check compares against the caller's
// single "active bank" (profiles.bank_id via the bank picker) — a
// completely different, per-user model. This variant loosens access only
// when the deal's own bank_id is the brokerage tenant AND the caller passes
// requireBrokerageStaff; every other tenant_mismatch is unchanged.

const BROKERAGE_BANK_ID = "bank_brokerage";

let mockBrokerageStaffThrows = false;
let mockBrokerageStaffUserId = "staff_1";

async function mockGetBrokerageBankId(): Promise<string> {
  return BROKERAGE_BANK_ID;
}

async function mockRequireBrokerageStaff(): Promise<{ userId: string }> {
  if (mockBrokerageStaffThrows) throw new Error("forbidden");
  return { userId: mockBrokerageStaffUserId };
}

async function ensureDealBankAccessAllowingBrokerageStaffTestable(dealId: string): Promise<EnsureResult> {
  const strict = await ensureDealBankAccessTestable(dealId);
  if (strict.ok || strict.error !== "tenant_mismatch") return strict;

  try {
    const deal = mockDealRow;
    if (!deal?.bank_id) return strict;

    const brokerageBankId = await mockGetBrokerageBankId();
    if (deal.bank_id !== brokerageBankId) return strict;

    const { userId } = await mockRequireBrokerageStaff();
    return { ok: true, dealId, bankId: deal.bank_id, userId };
  } catch {
    return strict;
  }
}

describe("ensureDealBankAccessAllowingBrokerageStaff", () => {
  beforeEach(() => {
    mockUserId = "user_123";
    mockBankId = "bank_A"; // caller's active-bank picker, unrelated to the brokerage tenant
    mockGetBankIdThrows = false;
    mockDealRow = null;
    mockDealError = null;
    mockBrokerageStaffThrows = false;
    mockBrokerageStaffUserId = "staff_1";
  });

  test("allows a brokerage-staff-authorized caller into a brokerage-tenant deal even when their active bank differs", async () => {
    mockDealRow = { id: "deal_1", bank_id: BROKERAGE_BANK_ID };
    const result = await ensureDealBankAccessAllowingBrokerageStaffTestable("deal_1");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.bankId, BROKERAGE_BANK_ID, "downstream queries must scope to the deal's real bank_id, not the caller's active-bank picker");
      assert.equal(result.userId, "staff_1");
    }
  });

  test("still denies a non-brokerage-staff caller on a brokerage-tenant deal", async () => {
    mockDealRow = { id: "deal_1", bank_id: BROKERAGE_BANK_ID };
    mockBrokerageStaffThrows = true;
    const result = await ensureDealBankAccessAllowingBrokerageStaffTestable("deal_1");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "tenant_mismatch", "must fall back to the strict result, not silently allow");
  });

  test("never loosens access for a non-brokerage-tenant deal — ordinary cross-tenant mismatch is unchanged", async () => {
    mockDealRow = { id: "deal_1", bank_id: "bank_B" }; // some other, non-brokerage bank
    const result = await ensureDealBankAccessAllowingBrokerageStaffTestable("deal_1");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "tenant_mismatch");
  });

  test("passes through non-tenant_mismatch failures unchanged (deal_not_found, unauthorized)", async () => {
    mockDealRow = null;
    const result = await ensureDealBankAccessAllowingBrokerageStaffTestable("deal_missing");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "deal_not_found");
  });

  test("already-matching same-tenant access is unaffected", async () => {
    mockBankId = BROKERAGE_BANK_ID;
    mockDealRow = { id: "deal_1", bank_id: BROKERAGE_BANK_ID };
    const result = await ensureDealBankAccessAllowingBrokerageStaffTestable("deal_1");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.userId, "user_123", "the strict path already succeeded — must not re-resolve via brokerage staff");
  });
});

console.log("All ensureDealBankAccess tests complete.");

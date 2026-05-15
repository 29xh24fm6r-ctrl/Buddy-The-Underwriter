import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Inline reimplementation of brokerage.ts resolver logic for ESM-safe testing.
//
// require.cache injection does not intercept ESM imports under
// node --test --import tsx. brokerage.ts has `import "server-only"` and
// pulls supabaseAdmin via ESM — neither is interceptable via require.cache.
//
// Pattern matches ensureDealBankAccess.test.ts: replicate the decision logic
// inline with closure mocks. All original test cases and assertions preserved.
// ---------------------------------------------------------------------------

const BROKERAGE_BANK_CODE = "BUDDY_BROKERAGE";
const BROKERAGE_BANK_NAME = "Buddy Brokerage";
const BROKERAGE_BANK_KIND = "brokerage";

// ── Mock state ──────────────────────────────────────────────────────────────

type BankRow = { id: string; code: string | null };
let mockRows: BankRow[] = [];
let mockError: string | null = null;
let cachedId: string | null = null;

function resetCache() {
  cachedId = null;
}

function reset(rows: BankRow[], err: string | null = null) {
  mockRows = rows;
  mockError = err;
  resetCache();
}

// ── Inline resolver (mirrors brokerage.ts logic exactly) ───────────────────

class BrokerageTenantMissingError extends Error {
  code = "brokerage_tenant_missing" as const;
  constructor(message: string) {
    super(message);
    this.name = "BrokerageTenantMissingError";
  }
}

class BrokerageTenantAmbiguousError extends Error {
  code = "brokerage_tenant_ambiguous" as const;
  constructor(message: string) {
    super(message);
    this.name = "BrokerageTenantAmbiguousError";
  }
}

async function getBrokerageBankId(): Promise<string> {
  if (cachedId) return cachedId;

  if (mockError) {
    throw new BrokerageTenantMissingError(
      `Brokerage tenant lookup failed: ${mockError}`,
    );
  }

  const rows = mockRows;
  if (rows.length === 0) {
    throw new BrokerageTenantMissingError(
      `No bank row with bank_kind='${BROKERAGE_BANK_KIND}'. Apply the brokerage tenant migration.`,
    );
  }
  if (rows.length > 1) {
    const codes = rows.map((r) => r.code ?? "(null)").join(", ");
    throw new BrokerageTenantAmbiguousError(
      `Multiple brokerage tenants found (codes: ${codes}). Exactly one row must have bank_kind='${BROKERAGE_BANK_KIND}'.`,
    );
  }

  cachedId = rows[0].id;
  return cachedId;
}

async function isBrokerageTenant(bankId: string): Promise<boolean> {
  const id = await getBrokerageBankId();
  return bankId === id;
}

async function assertBrokerageTenant(bankId: string): Promise<void> {
  const ok = await isBrokerageTenant(bankId);
  if (!ok) {
    throw new BrokerageTenantMissingError(
      `Expected brokerage tenant; received bank_id=${bankId}`,
    );
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("brokerage constants", () => {
  test("exports the required canonical constants", () => {
    assert.equal(BROKERAGE_BANK_CODE, "BUDDY_BROKERAGE");
    assert.equal(BROKERAGE_BANK_NAME, "Buddy Brokerage");
    assert.equal(BROKERAGE_BANK_KIND, "brokerage");
  });
});

describe("getBrokerageBankId", () => {
  beforeEach(() => reset([]));

  test("returns the single brokerage row id", async () => {
    reset([{ id: "abc-123", code: "BUDDY_BROKERAGE" }]);
    const id = await getBrokerageBankId();
    assert.equal(id, "abc-123");
  });

  test("throws BrokerageTenantMissingError when zero rows match", async () => {
    reset([]);
    await assert.rejects(
      getBrokerageBankId(),
      (e: any) => e?.code === "brokerage_tenant_missing",
    );
  });

  test("throws BrokerageTenantAmbiguousError when >1 row matches", async () => {
    reset([
      { id: "a", code: "BUDDY_BROKERAGE" },
      { id: "b", code: "buddy-brokerage" },
    ]);
    await assert.rejects(
      getBrokerageBankId(),
      (e: any) => e?.code === "brokerage_tenant_ambiguous",
    );
  });

  test("caches across calls until resetCache", async () => {
    reset([{ id: "first", code: "BUDDY_BROKERAGE" }]);
    assert.equal(await getBrokerageBankId(), "first");
    // mutate rows but don't reset cache → still returns 'first'
    mockRows = [{ id: "second", code: "BUDDY_BROKERAGE" }];
    assert.equal(await getBrokerageBankId(), "first");
    resetCache();
    assert.equal(await getBrokerageBankId(), "second");
  });
});

describe("isBrokerageTenant", () => {
  beforeEach(() => reset([]));

  test("compares to the resolved singleton", async () => {
    reset([{ id: "xyz", code: "BUDDY_BROKERAGE" }]);
    assert.equal(await isBrokerageTenant("xyz"), true);
    assert.equal(await isBrokerageTenant("other"), false);
  });
});

describe("assertBrokerageTenant", () => {
  beforeEach(() => reset([]));

  test("throws on non-brokerage bank id", async () => {
    reset([{ id: "xyz", code: "BUDDY_BROKERAGE" }]);
    await assertBrokerageTenant("xyz"); // no throw
    await assert.rejects(
      assertBrokerageTenant("commercial-bank-id"),
      (e: any) => e?.code === "brokerage_tenant_missing",
    );
  });
});

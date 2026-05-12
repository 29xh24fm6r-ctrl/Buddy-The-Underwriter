import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Buddy Brokerage tenant helpers.
 *
 * The brokerage is a singleton tenant on the existing `banks` table,
 * discriminated by `bank_kind='brokerage'`. Application code never
 * hardcodes the brokerage UUID — it always resolves through this module.
 *
 * Spec: specs/brokerage/SPEC-BROKERAGE-PRODUCTIONIZATION-V1.md §Phase 1.
 *
 * Tenancy invariant: exactly one row with bank_kind='brokerage'. The
 * resolver throws clearly when zero or multiple are present so we never
 * silently route deals to the wrong tenant.
 *
 * Code-value note: the production row was seeded by
 * `20260425_brokerage_tenant_model.sql` with code='BUDDY_BROKERAGE'.
 * BROKERAGE_BANK_CODE here matches that live value. The newer
 * `20260620000001_brokerage_singleton_assert.sql` migration enforces the
 * uniqueness invariant going forward.
 */

export const BROKERAGE_BANK_CODE = "BUDDY_BROKERAGE";
export const BROKERAGE_BANK_NAME = "Buddy Brokerage";
export const BROKERAGE_BANK_KIND = "brokerage" as const;

let cachedBrokerageId: string | null = null;

export class BrokerageTenantMissingError extends Error {
  code = "brokerage_tenant_missing" as const;
  constructor(message: string) {
    super(message);
    this.name = "BrokerageTenantMissingError";
  }
}

export class BrokerageTenantAmbiguousError extends Error {
  code = "brokerage_tenant_ambiguous" as const;
  constructor(message: string) {
    super(message);
    this.name = "BrokerageTenantAmbiguousError";
  }
}

/**
 * Resolve the singleton brokerage bank id. Throws BrokerageTenantMissingError
 * if zero rows match `bank_kind='brokerage'`, and BrokerageTenantAmbiguousError
 * if more than one matches. Memoized per process.
 */
export async function getBrokerageBankId(): Promise<string> {
  if (cachedBrokerageId) return cachedBrokerageId;
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("banks")
    .select("id, code")
    .eq("bank_kind", BROKERAGE_BANK_KIND);

  if (error) {
    throw new BrokerageTenantMissingError(
      `Brokerage tenant lookup failed: ${error.message}`,
    );
  }
  const rows = (data ?? []) as Array<{ id: string; code: string | null }>;
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
  cachedBrokerageId = rows[0].id;
  return cachedBrokerageId;
}

export async function isBrokerageTenant(bankId: string): Promise<boolean> {
  const brokerageId = await getBrokerageBankId();
  return bankId === brokerageId;
}

/**
 * Throws if the given bankId is NOT the singleton brokerage tenant.
 * Use at the entry of brokerage-only handlers to fail fast when a deal
 * accidentally carries a commercial-bank tenant id.
 */
export async function assertBrokerageTenant(bankId: string): Promise<void> {
  const ok = await isBrokerageTenant(bankId);
  if (!ok) {
    throw new BrokerageTenantMissingError(
      `Expected brokerage tenant; received bank_id=${bankId}`,
    );
  }
}

/**
 * Direct lookup against `banks.bank_kind` — useful when you already have
 * a bank id from an unrelated path (e.g. webhooks) and want to branch on
 * tenant kind without resolving the brokerage singleton first.
 */
export async function isBrokerageKind(bankId: string): Promise<boolean> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("banks")
    .select("bank_kind")
    .eq("id", bankId)
    .single();
  return data?.bank_kind === BROKERAGE_BANK_KIND;
}

/**
 * Test-only — clears the in-process cache so unit tests can re-resolve
 * after mutating the underlying mock client.
 */
export function __test_resetBrokerageCache(): void {
  cachedBrokerageId = null;
}

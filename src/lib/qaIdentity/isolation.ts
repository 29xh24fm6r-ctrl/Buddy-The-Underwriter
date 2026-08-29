import "server-only";

/**
 * Isolation helpers for test applications.
 *
 * SPEC-BORROWER-QA-IDENTITY-V1 §3
 *
 * These are server-side enforcement points. Every data path that should
 * exclude test applications must call isTestDealFilter() and append the
 * returned filter to its Supabase query.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type DealIsolationErrorCode =
  | "test_application"
  | "not_test_application"
  | "deal_not_found"
  | "state_unavailable";

export class DealIsolationError extends Error {
  readonly code: DealIsolationErrorCode;

  constructor(code: DealIsolationErrorCode, message: string) {
    super(message);
    this.name = "DealIsolationError";
    this.code = code;
  }
}

/**
 * Returns a Supabase filter that excludes test applications.
 * Append to any .select() or query chain:
 *
 *   .filter("is_test", "eq", false)
 *
 * This is the canonical server-side enforcement point.
 */
export function isTestDealFilter() {
  return { column: "is_test" as const, value: false };
}

/**
 * Checks whether a given deal is a test application.
 *
 * Missing or unavailable authoritative state is never equivalent to a
 * production deal. Callers must handle DealIsolationError explicitly.
 */
export async function isDealTestApplication(
  dealId: string,
  sb: SupabaseClient,
): Promise<boolean> {
  const { data, error } = await sb
    .from("deals")
    .select("is_test")
    .eq("id", dealId)
    .maybeSingle();

  if (error) {
    throw new DealIsolationError(
      "state_unavailable",
      "Unable to verify deal isolation state.",
    );
  }
  if (!data) {
    throw new DealIsolationError("deal_not_found", "Deal does not exist.");
  }

  const isTest = (data as { is_test?: unknown }).is_test;
  if (typeof isTest !== "boolean") {
    throw new DealIsolationError(
      "state_unavailable",
      "Deal isolation state is invalid.",
    );
  }
  return isTest;
}

/**
 * Guards a deal from being sent to real lenders.
 * Throws if the deal is a test application or authoritative state is
 * unavailable.
 *
 * Call this at the entry of any lender-matching, marketplace, or package
 * distribution endpoint.
 */
export async function assertNotTestDeal(
  dealId: string,
  sb: SupabaseClient,
): Promise<void> {
  const isTest = await isDealTestApplication(dealId, sb);
  if (isTest) {
    throw new DealIsolationError(
      "test_application",
      "Test applications cannot be sent to real lenders.",
    );
  }
}

/**
 * Primarily for test cleanup — ensures non-test records are never deleted.
 * Throws if the deal is NOT a test application or authoritative state is
 * unavailable.
 */
export async function assertIsTestDeal(
  dealId: string,
  sb: SupabaseClient,
): Promise<void> {
  const isTest = await isDealTestApplication(dealId, sb);
  if (!isTest) {
    throw new DealIsolationError(
      "not_test_application",
      "Cleanup cannot operate on production data.",
    );
  }
}

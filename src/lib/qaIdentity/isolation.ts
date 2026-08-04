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
 */
export async function isDealTestApplication(
  dealId: string,
  sb: SupabaseClient,
): Promise<boolean> {
  const { data } = await sb
    .from("deals")
    .select("is_test")
    .eq("id", dealId)
    .maybeSingle();

  return (data as any)?.is_test === true;
}

/**
 * Guards a deal from being sent to real lenders.
 * Throws if the deal is a test application.
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
    throw new Error(
      `Deal ${dealId} is a test application — cannot be sent to real lenders.`,
    );
  }
}

/**
 * Primarily for test cleanup — ensures non-test records are never deleted.
 * Throws if the deal is NOT a test application.
 */
export async function assertIsTestDeal(
  dealId: string,
  sb: SupabaseClient,
): Promise<void> {
  const isTest = await isDealTestApplication(dealId, sb);
  if (!isTest) {
    throw new Error(
      `Deal ${dealId} is not a test application — cleanup cannot operate on production data.`,
    );
  }
}

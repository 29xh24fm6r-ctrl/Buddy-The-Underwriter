"use client";

/**
 * Test application banner.
 *
 * Displays a persistent warning when the current deal is a test application.
 * Derived from persisted is_test state — never computed from heuristics.
 *
 * SPEC-BORROWER-QA-IDENTITY-V1 §4
 *
 * Usage:
 *   <TestApplicationBanner isTest={deal.is_test} />
 */

export function TestApplicationBanner({ isTest }: { isTest: boolean }) {
  if (!isTest) return null;

  return (
    <div
      role="alert"
      className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-sm font-medium text-amber-800"
    >
      Test application — never shared with lenders
    </div>
  );
}

/**
 * Server-compatible check: returns the test banner props for a given deal.
 * Use in server components that fetch the deal.
 */
export function getTestBannerProps(deal: { is_test?: boolean | null }) {
  return {
    isTest: deal.is_test === true,
  };
}

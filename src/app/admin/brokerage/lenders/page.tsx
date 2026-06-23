import "server-only";

import LendersClient from "./LendersClient";

export const dynamic = "force-dynamic";

/**
 * /admin/brokerage/lenders — lender control center.
 *
 * Load, update, and offboard marketplace lenders. Each lender is a
 * banks identity + a lender_programs matching row + an active
 * lender_marketplace_agreements row; the API behind this page keeps
 * the three in sync.
 *
 * Access: the /admin layout requires super_admin. The API route this
 * page talks to carries its own super-admin gate as well.
 */
export default function AdminBrokerageLendersPage() {
  return (
    <main className="px-8 py-10 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Lenders</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Load lenders into the brokerage marketplace. Listings can only match
          lenders that have an active agreement and at least one program.
        </p>
      </header>
      <LendersClient />
    </main>
  );
}

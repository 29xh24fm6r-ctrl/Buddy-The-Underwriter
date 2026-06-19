import "server-only";

/**
 * /deals/[dealId]/borrower — Management, Sponsor & Guarantor Profiles
 *
 * SPEC-BORROWER-ENTITY-SPONSOR-SEPARATION-1: this page documents the people and
 * entities that SUPPORT the borrower (deal_management_profiles) — it does NOT
 * attach the legal borrower entity. Legal borrower identity (borrower_id /
 * borrower_name / deal_borrower_story.legal_name) is a separate credit concept;
 * see src/lib/borrower/borrowerIdentity.ts.
 *
 * BUG-BORROWER-PROFILE-STITCH-LIVE-1:
 * This route was previously backed by an empty 0-byte Stitch export
 * (stitch_exports/borrower-profile/code.html), so the page rendered a "needs
 * re-export" placeholder, leaving bankers unable to attach/document a borrower,
 * sponsor, or guarantor from the deal workflow.
 *
 * It is now a functional native surface — mirroring the credit_committee_view
 * migration from a Stitch iframe to a native client. It reuses the canonical,
 * already-tested ManagementProfilesForm, which persists to
 * deal_management_profiles via POST/PATCH/DELETE /api/deals/[dealId]/memo-inputs
 * (kind: "management"). Saving here clears the Memo Inputs blockers
 * missing_management_profile ("No management profile on file") and
 * structural_no_guarantor_documented ("Guarantor / sponsor not documented"),
 * because the same handler triggers a readiness refresh.
 *
 * The borrower_profile key is whitelisted in the Stitch native-fallback guard's
 * MIXED_MODE_SURFACES set so this native page does not require a Stitch embed.
 */

import Link from "next/link";

import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { buildMemoInputPackage } from "@/lib/creditMemo/inputs/buildMemoInputPackage";
import ManagementProfilesForm from "@/components/creditMemo/inputs/ManagementProfilesForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function BorrowerProfilePage(props: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await props.params;
  await requireDealAccess(dealId);

  const result = await buildMemoInputPackage({
    dealId,
    runReconciliation: false,
  });

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="mx-auto max-w-[1100px] p-8 space-y-6">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold text-gray-900">
            Management, Sponsor &amp; Guarantor Profiles
          </h1>
          <p className="text-sm text-gray-600">
            Document the people and entities that <strong>support</strong> the
            borrower — principals, officers, sponsors, and guarantors. This page
            does <strong>not</strong> attach the legal borrower entity itself;
            it captures the supporting profiles committee evaluates individually.
            At least one profile is required before the credit memo can be
            submitted.
          </p>
          <p className="text-xs text-gray-500">
            Saved profiles flow into{" "}
            <Link
              href={`/deals/${dealId}/memo-inputs#management`}
              className="font-medium text-gray-700 underline hover:text-gray-900"
            >
              Memo Inputs
            </Link>{" "}
            and clear the management / guarantor readiness blockers.
          </p>
        </header>

        {!result.ok ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            Unable to load borrower profiles: {result.error ?? result.reason}
          </div>
        ) : (
          <ManagementProfilesForm
            dealId={dealId}
            initial={result.package.management_profiles}
            returnToMemoInputsHref={`/deals/${dealId}/memo-inputs`}
          />
        )}
      </div>
    </div>
  );
}

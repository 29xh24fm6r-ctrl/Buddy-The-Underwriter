import "server-only";

/**
 * /deals/[dealId]/memo-inputs
 *
 * Memo Inputs control center — pre-memo gate that proves Buddy has
 * everything required for a Florida Armory-grade credit memo before the
 * banker submits it.
 *
 * SPEC-13 — body extracted into `<MemoInputsBody />` so the credit-memo
 * route can render the same surface inline when its gate fails.
 */

import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { buildMemoInputPackage } from "@/lib/creditMemo/inputs/buildMemoInputPackage";

import MemoInputsBody from "@/components/creditMemo/inputs/MemoInputsBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function MemoInputsPage(props: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await props.params;
  await requireDealAccess(dealId);

  const result = await buildMemoInputPackage({
    dealId,
    runReconciliation: true,
  });

  if (!result.ok) {
    return (
      <div className="bg-white min-h-screen p-8">
        <div className="mx-auto max-w-[980px]">
          <h1 className="text-xl font-semibold text-gray-900">Memo Inputs</h1>
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            Unable to load memo input package: {result.error ?? result.reason}
          </div>
        </div>
      </div>
    );
  }

  const pkg = result.package;

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="mx-auto max-w-[1100px] p-8 space-y-6">
        <header>
          <h1 className="text-xl font-semibold text-gray-900">Memo Inputs</h1>
          <p className="text-sm text-gray-600">
            Pre-memo control center. The submission gate enforces every
            section here before a credit memo can be sent to underwriting.
          </p>
        </header>

        <MemoInputsBody dealId={dealId} pkg={pkg} />
      </div>
    </div>
  );
}

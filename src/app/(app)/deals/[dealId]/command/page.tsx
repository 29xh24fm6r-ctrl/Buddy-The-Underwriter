// src/app/(app)/deals/[dealId]/command/page.tsx
import { CommandShell } from "./CommandShell";
import { DealSmsTimeline } from "./DealSmsTimeline";
import { Suspense } from "react";
import { verifyUnderwrite } from "@/lib/deals/verifyUnderwrite";

export const dynamic = "force-dynamic";

export default async function DealCommandPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;

  if (!dealId) {
    return (
      <main className="min-h-screen p-10">
        <div className="mx-auto max-w-6xl text-red-600">
          Missing dealId — route params not found.
        </div>
      </main>
    );
  }

  const verify = await verifyUnderwrite({ dealId, actor: "banker" });

  return (
    <>
      {!verify.ok ? (
        <div className="mx-auto max-w-6xl px-6 pt-6">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <div className="text-sm font-semibold">⚠️ Underwriting not available</div>
            <div className="mt-1 text-xs">
              This deal is not ready for underwriting.
            </div>
            <div className="mt-2 text-xs">Next action: {verify.recommendedNextAction}</div>
            {verify.diagnostics?.missing?.length ? (
              <div className="mt-1 text-xs">
                Missing: {verify.diagnostics.missing.join(", ")}
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {verify.recommendedNextAction === "complete_intake" ? (
                <a
                  href={`/deals/${dealId}`}
                  className="rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Complete Intake
                </a>
              ) : null}
              {verify.recommendedNextAction === "checklist_incomplete" ? (
                <a
                  href={`/deals/${dealId}/documents`}
                  className="rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Request Documents
                </a>
              ) : null}
              {verify.recommendedNextAction === "pricing_required" ? (
                <a
                  href={`/deals/${dealId}/pricing`}
                  className="rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Run Pricing
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <CommandShell dealId={dealId} verify={verify} />

      {/* SMS Timeline (floating overlay in bottom-right) */}
      <div className="fixed bottom-4 right-4 z-50 w-96 max-h-[60vh] overflow-auto">
        <Suspense
          fallback={
            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-lg">
              <div className="text-sm text-neutral-500">Loading SMS activity...</div>
            </div>
          }
        >
          <DealSmsTimeline dealId={dealId} />
        </Suspense>
      </div>
    </>
  );
}

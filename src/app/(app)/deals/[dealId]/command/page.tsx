// src/app/(app)/deals/[dealId]/command/page.tsx
import { CommandShell } from "./CommandShell";
import { DealSmsTimeline } from "./DealSmsTimeline";
import { Suspense } from "react";
import { verifyUnderwrite } from "@/lib/deals/verifyUnderwrite";
import { computeNextStep } from "@/core/nextStep/computeNextStep";
import Link from "next/link";

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
  const nextAction = await computeNextStep({
    dealId,
    deps: {
      verifyUnderwrite: async () => verify,
    },
  });
  const isBuilder = process.env.NEXT_PUBLIC_BUDDY_ROLE === "builder";

  const nextStep =
    !verify.ok && verify.recommendedNextAction === "deal_not_found"
      ? { key: "deal_not_found", deepLink: "/deals" }
      : nextAction;

  const blockedCopy = {
    complete_intake: "Complete intake details to continue",
    request_docs: "Required documents are missing",
    set_pricing_assumptions: "Pricing assumptions must be set",
    open_underwriting: "This deal is ready for underwriting",
    deal_not_found: "Deal setup is incomplete",
  } as const;

  if (!verify.ok) {
    const nextStepCopy =
      blockedCopy[nextStep.key as keyof typeof blockedCopy] ??
      "Complete intake details to continue";

    return (
      <main className="min-h-screen bg-white">
        <div className="mx-auto max-w-4xl px-6 py-14">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
            <div className="text-sm font-semibold">⚠️ Underwriting not available</div>
            <div className="mt-1 text-xl font-semibold text-amber-950">
              This deal is not ready for underwriting.
            </div>
            <div className="mt-2 text-sm text-amber-900">
              Next step: {nextStepCopy}.
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link
                href={nextStep.deepLink}
                className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                Next Step →
              </Link>
            </div>
          </div>

          {isBuilder ? (
            <details className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-xs text-neutral-700">
              <summary className="cursor-pointer font-semibold text-neutral-800">
                Diagnostics
              </summary>
              <pre className="mt-3 whitespace-pre-wrap">
                {JSON.stringify(
                  {
                    recommendedNextAction: verify.recommendedNextAction,
                    missing: verify.diagnostics?.missing ?? [],
                    lifecycleStage: verify.diagnostics?.lifecycleStage ?? null,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <>
      <div className="mx-auto max-w-6xl px-6 pt-8">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-900">
          <div className="text-sm font-semibold">Underwriting Ready</div>
          <div className="mt-1 text-xl font-semibold text-emerald-950">
            This deal is ready for underwriting.
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              href={nextStep.deepLink}
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              Next Step →
            </Link>
          </div>
        </div>
      </div>

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

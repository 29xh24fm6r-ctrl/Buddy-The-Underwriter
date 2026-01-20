import { computeNextStep } from "@/core/nextStep/computeNextStep";
import type { VerifyUnderwriteBlocked } from "@/lib/deals/verifyUnderwriteCore";
import Link from "next/link";

const labelForAction: Record<string, string> = {
  complete_intake: "Complete Intake",
  request_docs: "Request Documents",
  run_pricing: "Run Pricing",
  open_underwriting: "Open Underwriting",
  deal_not_found: "Go to Deals",
};

const reasonForAction: Record<string, string> = {
  complete_intake: "Complete intake details to continue.",
  request_docs: "Required documents are missing.",
  run_pricing: "Pricing must be completed.",
  open_underwriting: "This deal is ready for underwriting.",
  deal_not_found: "Deal setup is incomplete.",
};

export async function UnderwriteBlockedPanel({
  dealId,
  verify,
}: {
  dealId: string;
  verify: VerifyUnderwriteBlocked;
}) {
  const nextAction = await computeNextStep({
    dealId,
    deps: {
      verifyUnderwrite: async () => verify,
    },
  });

  const isDealMissing =
    !verify.ok && verify.recommendedNextAction === "deal_not_found";

  const deepLink = isDealMissing ? "/deals" : nextAction.deepLink;
  const actionKey = isDealMissing ? "deal_not_found" : nextAction.key;

  const builderMode =
    process.env.BUDDY_BUILDER_MODE === "1" ||
    process.env.NEXT_PUBLIC_BUDDY_ROLE === "builder";

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="rounded-xl border border-neutral-200 bg-white p-6">
        <h1 className="text-2xl font-bold text-neutral-900">Underwriting not available</h1>
        <p className="mt-2 text-sm text-neutral-600">
          {reasonForAction[actionKey] ?? "This deal is not ready for underwriting."}
        </p>
        {verify.diagnostics?.missing?.length ? (
          <div className="mt-4 text-xs text-neutral-500">
            Missing: {verify.diagnostics.missing.join(", ")}
          </div>
        ) : null}
        {verify.diagnostics?.lifecycleStage ? (
          <div className="mt-2 text-xs text-neutral-500">
            Lifecycle stage: {verify.diagnostics.lifecycleStage}
          </div>
        ) : null}
        <div className="mt-4">
          <Link
            href={deepLink}
            className="inline-flex items-center rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-800"
          >
            {labelForAction[actionKey] ?? "Next Step"}
          </Link>
        </div>
        {builderMode ? (
          <pre className="mt-4 max-h-48 overflow-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-[11px] text-neutral-700">
            {JSON.stringify(verify, null, 2)}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

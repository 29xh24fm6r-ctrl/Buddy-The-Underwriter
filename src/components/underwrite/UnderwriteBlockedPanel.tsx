import { computeNextStep } from "@/core/nextStep/computeNextStep";
import type { VerifyUnderwriteBlocked } from "@/lib/deals/verifyUnderwriteCore";
import Link from "next/link";

const labelForAction: Record<string, string> = {
  complete_intake: "Complete Intake",
  request_docs: "Request Documents",
  set_pricing_assumptions: "Set Pricing Assumptions",
  open_underwriting: "Open Underwriting",
  deal_not_found: "Go to Deals",
};

const reasonForAction: Record<string, string> = {
  complete_intake: "Complete intake details to continue.",
  request_docs: "Required documents are missing.",
  set_pricing_assumptions: "Pricing assumptions must be set before underwriting.",
  open_underwriting: "This deal is ready for underwriting.",
  deal_not_found: "Deal setup is incomplete.",
};

export async function UnderwriteBlockedPanel({
  dealId,
  verify,
  verifyLedger,
}: {
  dealId: string;
  verify: VerifyUnderwriteBlocked;
  verifyLedger?: {
    status?: "pass" | "fail";
    source?: "builder" | "runtime";
    details?: {
      url?: string;
      httpStatus?: number;
      auth?: boolean;
      html?: boolean;
      metaFallback?: boolean;
      error?: string;
      redacted?: boolean;
    };
    recommendedNextAction?: string | null;
    diagnostics?: Record<string, unknown> | null;
    createdAt?: string | null;
  } | null;
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
  const missing = verify.diagnostics?.missing ?? [];
  const completeIntakeLabel = missing.includes("deal_name")
    ? "Name this deal"
    : missing.includes("borrower")
      ? "Attach borrower"
      : labelForAction.complete_intake;
  const completeIntakeReason = missing.includes("deal_name")
    ? "Name the deal to unlock underwriting."
    : missing.includes("borrower")
      ? "Attach a borrower to continue."
      : reasonForAction.complete_intake;

  const verifyHint = verifyLedger?.details?.html
    ? "Underwrite endpoint returned HTML — likely auth-gated."
    : verifyLedger?.details?.metaFallback
      ? "Primary JSON unavailable, meta fallback used."
      : verifyLedger?.details?.auth === false
        ? "Session not authorized to start underwriting."
        : verifyLedger?.details?.error === "banker_test_mode"
          ? "Banker test mode blocks underwriting."
          : null;

  const builderMode =
    process.env.BUDDY_BUILDER_MODE === "1" ||
    process.env.NEXT_PUBLIC_BUDDY_ROLE === "builder";

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="rounded-xl border border-neutral-200 bg-white p-6">
        <h1 className="text-2xl font-bold text-neutral-900">Underwriting not available</h1>
        <p className="mt-2 text-sm text-neutral-600">
          {actionKey === "complete_intake"
            ? completeIntakeReason
            : reasonForAction[actionKey] ?? "This deal is not ready for underwriting."}
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
        {verifyHint ? (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {verifyHint}
          </div>
        ) : null}
        <div className="mt-4">
          <Link
            href={deepLink}
            className="inline-flex items-center rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-800"
          >
            {actionKey === "complete_intake"
              ? completeIntakeLabel
              : labelForAction[actionKey] ?? "Next Step"}
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

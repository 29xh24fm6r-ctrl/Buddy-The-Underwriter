// src/components/stitch/StitchRouteBridge.tsx

import StitchFrame from "@/components/stitch/StitchFrame";
import { getStrippedStitchHtml } from "@/lib/stitch/getStrippedStitchHtml";
import { getReactReplacement } from "@/lib/stitch/stitchReplace";

// ── Existing activation imports ──────────────────────────────
import {
  buildPortfolioCommandBridgeActivationScript,
  getPortfolioCommandBridgeActivationData,
  serializeActivationData,
} from "@/lib/stitch/activations/portfolioCommandBridgeActivation";
import {
  buildBorrowerPortalActivationScript,
  getBorrowerPortalActivationData,
  serializeActivationData as serializeBorrowerPortalActivationData,
} from "@/lib/stitch/activations/borrowerPortalActivation";
import {
  buildDealIntakeConsoleActivationScript,
  getDealIntakeConsoleActivationData,
  serializeActivationData as serializeIntakeActivationData,
} from "@/lib/stitch/activations/dealIntakeConsoleActivation";
import {
  buildUnderwriteCommandBridgeActivationScript,
  getUnderwriteCommandBridgeActivationData,
  serializeActivationData as serializeUnderwriteActivationData,
} from "@/lib/stitch/activations/underwriteCommandBridgeActivation";

// ── Phase 65A canonical state injection ──────────────────────
import {
  fetchCanonicalStatePayload,
  buildCanonicalStateRenderScript,
} from "@/lib/stitch/activations/canonicalStateInjection";

// ── Phase 62C activation imports ─────────────────────────────
import {
  buildCreditCommitteeViewActivationScript,
  getCreditCommitteeViewActivationData,
  serializeCreditCommitteeViewData,
} from "@/lib/stitch/activations/creditCommitteeViewActivation";
import {
  buildExceptionsChangeReviewActivationScript,
  getExceptionsChangeReviewActivationData,
  serializeExceptionsData,
} from "@/lib/stitch/activations/exceptionsChangeReviewActivation";
import {
  buildBorrowerTaskInboxActivationScript,
  getBorrowerTaskInboxActivationData,
  serializeTaskInboxData,
} from "@/lib/stitch/activations/borrowerTaskInboxActivation";
import {
  buildBorrowerControlRecordActivationScript,
  getBorrowerControlRecordActivationData,
  serializeBorrowerControlData,
} from "@/lib/stitch/activations/borrowerControlRecordActivation";
import {
  buildPricingMemoActivationScript,
  getPricingMemoActivationData,
  serializePricingMemoData,
} from "@/lib/stitch/activations/pricingMemoActivation";

type StitchRouteBridgeProps = {
  slug: string;
  forceStitch?: boolean;
  activationContext?: {
    token?: string | null;
    dealId?: string | null;
  };
};

export default async function StitchRouteBridge({
  slug,
  forceStitch = false,
  activationContext,
}: StitchRouteBridgeProps) {
  // Fetch stripped Stitch HTML (chrome already removed)
  let bodyHtml: string;
  try {
    bodyHtml = await getStrippedStitchHtml(slug);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[StitchRouteBridge] FAILED to load export for slug="${slug}": ${message}`);
    return (
      <div
        data-stitch-bridge-error="true"
        data-stitch-slug={slug}
        className="rounded-2xl border-2 border-red-300 bg-red-50 p-8"
      >
        <div className="text-sm font-semibold text-red-800">
          Required Stitch surface missing
        </div>
        <dl className="mt-3 space-y-1 text-xs text-red-700">
          <div className="flex gap-2">
            <dt className="font-medium">Slug:</dt>
            <dd className="font-mono">{slug}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium">Reason:</dt>
            <dd>{message}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-red-600">
          The Stitch export for this surface could not be loaded. Check that{" "}
          <code className="rounded bg-red-100 px-1">stitch_exports/{slug}/code.html</code>{" "}
          exists and is included in the deployment bundle.
        </p>
      </div>
    );
  }

  let activationDataJson: string | undefined;
  let activationScript: string | undefined;

  // ── Existing activations ───────────────────────────────────
  if (slug === "portfolio-command-bridge") {
    const data = await getPortfolioCommandBridgeActivationData(200);
    activationDataJson = serializeActivationData(data);
    activationScript = buildPortfolioCommandBridgeActivationScript();
  }

  if (slug === "deal-intake-console") {
    const data = await getDealIntakeConsoleActivationData(25);
    activationDataJson = serializeIntakeActivationData(data);
    activationScript = buildDealIntakeConsoleActivationScript();
  }

  if (slug === "borrower-document-upload-review") {
    const token = activationContext?.token ?? null;
    const data = await getBorrowerPortalActivationData(token, 25);
    activationDataJson = serializeBorrowerPortalActivationData(data);
    activationScript = buildBorrowerPortalActivationScript();
  }

  if (slug === "deals-command-bridge") {
    const data = await getUnderwriteCommandBridgeActivationData(
      activationContext?.dealId ?? null,
      25,
    );
    activationDataJson = serializeUnderwriteActivationData(data);
    activationScript = buildUnderwriteCommandBridgeActivationScript();
  }

  // ── Phase 62C activations ──────────────────────────────────
  if (slug === "credit-committee-view") {
    const data = await getCreditCommitteeViewActivationData(50);
    activationDataJson = serializeCreditCommitteeViewData(data);
    activationScript = buildCreditCommitteeViewActivationScript();
  }

  if (slug === "exceptions-change-review") {
    const data = await getExceptionsChangeReviewActivationData(50);
    activationDataJson = serializeExceptionsData(data);
    activationScript = buildExceptionsChangeReviewActivationScript();
  }

  if (slug === "borrower-task-inbox") {
    const data = await getBorrowerTaskInboxActivationData(
      activationContext?.dealId ?? null,
      50,
    );
    activationDataJson = serializeTaskInboxData(data);
    activationScript = buildBorrowerTaskInboxActivationScript();
  }

  if (slug === "borrower-control-record") {
    const data = await getBorrowerControlRecordActivationData(50);
    activationDataJson = serializeBorrowerControlData(data);
    activationScript = buildBorrowerControlRecordActivationScript();
  }

  if (slug === "pricing-memo-command-center") {
    const data = await getPricingMemoActivationData(
      activationContext?.dealId ?? null,
    );
    activationDataJson = serializePricingMemoData(data);
    activationScript = buildPricingMemoActivationScript();
  }

  // ── Phase 65A: Inject canonical state + omega for P0 surfaces ──
  const p0Slugs = new Set([
    "deals-command-bridge",
    "credit-committee-view",
    "exceptions-change-review",
    "borrower-task-inbox",
    "pricing-memo-command-center",
  ]);

  if (p0Slugs.has(slug) && activationDataJson) {
    const dealId = activationContext?.dealId ?? null;
    const statePayload = await fetchCanonicalStatePayload(dealId);

    // Merge canonical state into existing activation data
    try {
      const existingData = JSON.parse(activationDataJson);
      existingData.canonicalState = statePayload.canonicalState;
      existingData.omega = statePayload.omega;
      existingData.explanation = statePayload.explanation;
      existingData.nextActions = statePayload.nextActions;
      existingData.primaryAction = statePayload.primaryAction;
      activationDataJson = JSON.stringify(existingData)
        .replace(/</g, "\\u003c")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
    } catch {
      // If parse fails, continue with original data
    }

    // Append canonical state render script
    const stateRenderScript = buildCanonicalStateRenderScript();
    activationScript = (activationScript ?? "") + "\n" + stateRenderScript;
  }

  return (
    <StitchFrame
      title="Buddy The Underwriter"
      pageSlug={slug}
      bodyHtml={bodyHtml}
      tailwindCdnSrc="https://cdn.tailwindcss.com"
      activationDataJson={activationDataJson}
      activationScript={activationScript}
    />
  );
}

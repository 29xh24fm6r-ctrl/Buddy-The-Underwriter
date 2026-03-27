// src/components/stitch/StitchRouteBridge.tsx

import StitchFrame from "@/components/stitch/StitchFrame";
import { getStrippedStitchHtml } from "@/lib/stitch/getStrippedStitchHtml";
import { getReactReplacement } from "@/lib/stitch/stitchReplace";
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

type StitchRouteBridgeProps = {
  /** Slug for the stitch export, e.g. "command-center-latest" */
  slug: string;
  /** Optional: force Stitch rendering even if React replacement exists */
  forceStitch?: boolean;
  activationContext?: {
    token?: string | null;
    dealId?: string | null;
  };
};

/**
 * Bridge component that renders a Stitch export inside a real Next.js route.
 * Preserves real URLs, auth, layout while using Stitch as the view layer.
 *
 * Supports progressive React replacement:
 * - If a React component is registered for this route, render it instead
 * - Otherwise, render the Stitch export
 */
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
    // Hard failure — do NOT silently render a generic placeholder.
    // Surface the failure so it's visible in dev, builder mode, and CI.
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

  if (slug === "portfolio-command-bridge") {
    const activationData = await getPortfolioCommandBridgeActivationData(200);
    activationDataJson = serializeActivationData(activationData);
    activationScript = buildPortfolioCommandBridgeActivationScript();
  }

  if (slug === "deal-intake-console") {
    const activationData = await getDealIntakeConsoleActivationData(25);
    activationDataJson = serializeIntakeActivationData(activationData);
    activationScript = buildDealIntakeConsoleActivationScript();
  }

  if (slug === "borrower-document-upload-review") {
    const token = activationContext?.token ?? null;
    const activationData = await getBorrowerPortalActivationData(token, 25);
    activationDataJson = serializeBorrowerPortalActivationData(activationData);
    activationScript = buildBorrowerPortalActivationScript();
  }

  if (slug === "deals-command-bridge") {
    const activationData = await getUnderwriteCommandBridgeActivationData(
      activationContext?.dealId ?? null,
      25
    );
    activationDataJson = serializeUnderwriteActivationData(activationData);
    activationScript = buildUnderwriteCommandBridgeActivationScript();
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

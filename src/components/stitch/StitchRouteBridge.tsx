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
  // Check for React replacement (requires pathname mapping)
  // For now, just render Stitch - React replacement can be added per-route
  // when you're ready to migrate specific pages

  // Fetch stripped Stitch HTML (chrome already removed)
  let bodyHtml: string;
  try {
    bodyHtml = await getStrippedStitchHtml(slug);
  } catch {
    // Stitch export not found — render fallback instead of crashing
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center">
        <p className="text-sm text-neutral-500">
          This surface is not yet available. Please check back later.
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

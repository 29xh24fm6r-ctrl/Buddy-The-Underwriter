// src/components/stitch/StitchRouteBridge.tsx

import StitchFrame from "@/components/stitch/StitchFrame";
import { getStrippedStitchHtml } from "@/lib/stitch/getStrippedStitchHtml";
import { getReactReplacement } from "@/lib/stitch/stitchReplace";

type StitchRouteBridgeProps = {
  /** Slug for the stitch export, e.g. "command-center-latest" */
  slug: string;
  /** Optional: force Stitch rendering even if React replacement exists */
  forceStitch?: boolean;
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
}: StitchRouteBridgeProps) {
  // Check for React replacement (requires pathname mapping)
  // For now, just render Stitch - React replacement can be added per-route
  // when you're ready to migrate specific pages
  
  // Fetch stripped Stitch HTML (chrome already removed)
  const bodyHtml = await getStrippedStitchHtml(slug);

  return (
    <StitchFrame
      title="Buddy The Underwriter"
      bodyHtml={bodyHtml}
      tailwindCdnSrc="https://cdn.tailwindcss.com"
    />
  );
}

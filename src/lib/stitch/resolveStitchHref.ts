// src/lib/stitch/resolveStitchHref.ts

import { STITCH_ROUTE_MAP } from "./stitchRouteMap";

/**
 * Resolves a Stitch href to a real Next.js route.
 * Returns null if the href should be handled by the browser (external links, etc.)
 */
export function resolveStitchHref(href: string): string | null {
  if (!href) return null;

  // Ignore external links
  if (
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:")
  ) {
    return null;
  }

  // Ignore anchors
  if (href.startsWith("#")) {
    return null;
  }

  for (const rule of STITCH_ROUTE_MAP) {
    if (rule.match(href)) {
      return rule.to(href);
    }
  }

  // No match found - return null to let browser handle it
  return null;
}

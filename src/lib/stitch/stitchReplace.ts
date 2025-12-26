// src/lib/stitch/stitchReplace.ts

/**
 * React Replacement Registry
 * 
 * Allows progressive migration from Stitch to React.
 * When a route matches, the React component renders instead of Stitch iframe.
 * 
 * Usage:
 * 1. Import the real React component (use dynamic import for code splitting)
 * 2. Map the route to the component
 * 3. StitchFrame will automatically render the React component
 */

import type { ComponentType } from "react";

export const STITCH_REPLACEMENTS: Record<string, ComponentType<any>> = {
  // Example: Replace credit-memo Stitch with real React component
  // "/credit-memo": dynamic(() => import("@/app/(app)/credit-memo/CreditMemoReact")),
  
  // Add more replacements here as you migrate from Stitch to React
  // "/pricing": PricingComponent,
  // "/admin": AdminComponent,
};

/**
 * Check if a route has a React replacement available
 */
export function hasReactReplacement(pathname: string): boolean {
  return pathname in STITCH_REPLACEMENTS;
}

/**
 * Get the React replacement component for a route
 */
export function getReactReplacement(pathname: string): ComponentType<any> | null {
  return STITCH_REPLACEMENTS[pathname] ?? null;
}

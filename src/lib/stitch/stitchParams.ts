// src/lib/stitch/stitchParams.ts

/**
 * Extracts route parameters from Stitch hrefs
 * Enables data-aware React takeover later
 */
export function extractStitchParams(href: string): Record<string, string> {
  const params: Record<string, string> = {};

  if (href.includes("/deals/")) {
    const id = href.split("/deals/")[1]?.split(/[/?#]/)[0];
    if (id) params.dealId = id;
  }

  // Add more param extraction rules as needed
  // Example: /borrower/[token]
  if (href.includes("/borrower/")) {
    const token = href.split("/borrower/")[1]?.split(/[/?#]/)[0];
    if (token) params.token = token;
  }

  return params;
}

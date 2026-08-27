/**
 * Domain-based public surface routing.
 *
 * BuddySBA.com → Brokerage (borrower-facing)
 * BuddyTheUnderwriter.com → Underwriter (bank-facing)
 * BuddyBrokerage.com → redirect to BuddySBA.com
 * localhost / dev → Brokerage (default)
 */

export type DomainProduct = "brokerage" | "underwriter";

export const PUBLIC_PRODUCT_ORIGINS: Record<DomainProduct, string> = {
  brokerage: "https://www.buddysba.com",
  underwriter: "https://www.buddytheunderwriter.com",
};

const BROKERAGE_MARKETING_HOSTS = new Set(["buddysba.com", "www.buddysba.com"]);
const UNDERWRITER_MARKETING_HOSTS = new Set([
  "buddytheunderwriter.com",
  "www.buddytheunderwriter.com",
]);

function normalizeHost(host: string | null): string {
  return (host ?? "").toLowerCase().replace(/:\d+$/, "");
}

export function resolveProductFromHost(host: string | null): DomainProduct {
  const h = normalizeHost(host);
  if (h.includes("buddytheunderwriter")) return "underwriter";
  if (h.includes("buddysba")) return "brokerage";
  if (h.includes("buddybrokerage")) return "brokerage"; // will 301 at middleware level
  return "brokerage"; // localhost, preview, dev → brokerage default
}

export function shouldRedirectBuddyBrokerage(host: string | null): boolean {
  return normalizeHost(host).includes("buddybrokerage");
}

/**
 * Keep each public product entry on the domain configured for that product.
 *
 * The production Clerk instance is intentionally bound to the underwriter
 * application domain. Rendering /underwriter on the borrower domain initializes
 * Clerk on an unsupported origin and crashes the public page before it can
 * navigate. These redirects run before the public-route short circuit.
 */
export function getPublicProductRedirect(
  host: string | null,
  path: string,
): string | null {
  const h = normalizeHost(host);
  const normalizedPath = path.replace(/\/+$/, "") || "/";

  if (BROKERAGE_MARKETING_HOSTS.has(h) && normalizedPath === "/underwriter") {
    return `${PUBLIC_PRODUCT_ORIGINS.underwriter}/`;
  }

  if (UNDERWRITER_MARKETING_HOSTS.has(h) && normalizedPath === "/brokerage") {
    return `${PUBLIC_PRODUCT_ORIGINS.brokerage}/`;
  }

  return null;
}

export function getCanonicalUrl(host: string | null, path: string): string {
  const product = resolveProductFromHost(host);
  return `${PUBLIC_PRODUCT_ORIGINS[product]}${path}`;
}

export function getMetadataForProduct(product: DomainProduct): {
  title: string;
  description: string;
} {
  if (product === "underwriter") {
    return {
      title: "Buddy The Underwriter | AI-Native Commercial Underwriting",
      description: "AI-native underwriting intelligence for SBA lenders. Document extraction, credit analysis, policy-aware memos, and approval tracking.",
    };
  }
  return {
    title: "Buddy SBA | SBA Loan Packaging & Lender Matching",
    description: "Get your SBA loan package built by AI and matched to qualified lenders. You pick the lender. We coordinate closing.",
  };
}

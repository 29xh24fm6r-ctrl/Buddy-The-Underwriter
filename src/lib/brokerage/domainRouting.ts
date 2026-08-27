/**
 * Domain-based public surface routing.
 *
 * BuddySBA.com → Brokerage (borrower-facing)
 * BuddyTheUnderwriter.com → Underwriter (bank-facing)
 * BuddyBrokerage.com → redirect to BuddySBA.com
 * localhost / dev → Brokerage (default)
 */

export type DomainProduct = "brokerage" | "underwriter";

export function resolveProductFromHost(host: string | null): DomainProduct {
  if (!host) return "brokerage";
  const h = host.toLowerCase().replace(/:\d+$/, ""); // strip port
  if (h.includes("buddytheunderwriter")) return "underwriter";
  if (h.includes("buddysba")) return "brokerage";
  if (h.includes("buddybrokerage")) return "brokerage"; // will 301 at middleware level
  return "brokerage"; // localhost, preview, dev → brokerage default
}

export function shouldRedirectBuddyBrokerage(host: string | null): boolean {
  if (!host) return false;
  return host.toLowerCase().replace(/:\d+$/, "").includes("buddybrokerage");
}

export function getCanonicalUrl(host: string | null, path: string): string {
  const product = resolveProductFromHost(host);
  // Both apex domains redirect to www in production. Canonical metadata must
  // name the final 200 URL so crawlers do not have to reconcile a redirecting
  // canonical with the document they fetched.
  const domain = product === "underwriter"
    ? "https://www.buddytheunderwriter.com"
    : "https://www.buddysba.com";
  return `${domain}${path}`;
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
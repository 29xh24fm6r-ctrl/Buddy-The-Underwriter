import type { Metadata } from "next";

import {
  getCanonicalUrl,
  getMetadataForProduct,
  type DomainProduct,
} from "@/lib/brokerage/domainRouting";

const PRODUCT_HOSTS: Record<DomainProduct, string> = {
  brokerage: "www.buddysba.com",
  underwriter: "www.buddytheunderwriter.com",
};

const PRODUCT_NAMES: Record<DomainProduct, string> = {
  brokerage: "Buddy SBA",
  underwriter: "Buddy The Underwriter",
};

/**
 * Complete, domain-specific public metadata.
 *
 * The root layout describes the authenticated underwriting application. Public
 * marketing pages must override every identity-bearing field; overriding only
 * `title` leaves canonical, Open Graph, Twitter, and description values from
 * the other product in the rendered document.
 */
export function buildProductMetadata(product: DomainProduct): Metadata {
  const copy = getMetadataForProduct(product);
  const canonical = getCanonicalUrl(PRODUCT_HOSTS[product], "/");
  const productName = PRODUCT_NAMES[product];
  const imageAlt =
    product === "brokerage"
      ? "Buddy SBA loan packaging and lender matching"
      : "Buddy The Underwriter";

  return {
    metadataBase: new URL(canonical),
    title: { absolute: copy.title },
    description: copy.description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      locale: "en_US",
      url: canonical,
      siteName: productName,
      title: copy.title,
      description: copy.description,
      images: [{ url: "/og.png", width: 1200, height: 630, alt: imageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title: copy.title,
      description: copy.description,
      images: ["/og.png"],
    },
  };
}
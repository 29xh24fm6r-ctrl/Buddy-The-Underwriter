import { UnderwriterLandingPage } from "@/components/marketing/UnderwriterLandingPage";
import { buildProductMetadata } from "@/lib/brokerage/productMetadata";

export const metadata = buildProductMetadata("underwriter");

export default function UnderwriterPage() {
  return <UnderwriterLandingPage />;
}
import { BrokerageLandingPage } from "@/components/marketing/BrokerageLandingPage";
import { buildProductMetadata } from "@/lib/brokerage/productMetadata";

export const metadata = buildProductMetadata("brokerage");

export default function BrokeragePage() {
  return <BrokerageLandingPage />;
}

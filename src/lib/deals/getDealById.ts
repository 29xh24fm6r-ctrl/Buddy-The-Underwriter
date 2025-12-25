import { sampleDeals } from "@/lib/deals/sampleDeals";

export function getDealById(dealId: string) {
  return sampleDeals.find((d) => d.id === dealId) ?? null;
}

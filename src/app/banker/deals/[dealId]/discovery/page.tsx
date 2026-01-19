// src/app/banker/deals/[dealId]/discovery/page.tsx
import DiscoveryClient from "./DiscoveryClient";
import { verifyUnderwrite } from "@/lib/deals/verifyUnderwrite";

export default async function BankerDealDiscoveryPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const verify = await verifyUnderwrite({ dealId, actor: "banker" });
  return (
    <DiscoveryClient params={params} underwriteAllowed={verify.ok} />
  );
}

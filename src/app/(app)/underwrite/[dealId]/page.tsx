import StitchRouteBridge from "@/components/stitch/StitchRouteBridge";
import { DealOutputsPanel } from "@/components/deals/DealOutputsPanel";

export const dynamic = "force-dynamic";

type UnderwriteDealPageProps = {
  params: Promise<{ dealId: string }> | { dealId: string };
};

export default async function UnderwriteDealPage({
  params,
}: UnderwriteDealPageProps) {
  const resolvedParams = await params;
  const dealId = resolvedParams.dealId;
  return (
    <div className="space-y-4">
      <div className="mx-auto w-full max-w-6xl px-4">
        <DealOutputsPanel dealId={dealId} />
      </div>
      <StitchRouteBridge
        slug="deals-command-bridge"
        activationContext={{ dealId }}
      />
    </div>
  );
}

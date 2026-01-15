import StitchRouteBridge from "@/components/stitch/StitchRouteBridge";

export const dynamic = "force-dynamic";

type UnderwriteDealPageProps = {
  params: { dealId: string };
};

export default async function UnderwriteDealPage({
  params,
}: UnderwriteDealPageProps) {
  return (
    <StitchRouteBridge
      slug="deals-command-bridge"
      activationContext={{ dealId: params.dealId }}
    />
  );
}

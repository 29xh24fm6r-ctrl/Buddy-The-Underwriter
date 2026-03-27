import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;

  return (
    <StitchSurface
      surfaceKey="deals_command_bridge"
      dealId={dealId}
      title="Underwriter Command Bridge"
      mode="iframe"
    />
  );
}

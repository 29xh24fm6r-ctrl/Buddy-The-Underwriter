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
      surfaceKey="pricing_memo_command_center"
      dealId={dealId}
      title="Pricing Memo"
      mode="iframe"
    />
  );
}

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
      surfaceKey="deal_output_credit_memo_spreads"
      dealId={dealId}
      title="Credit Memo & Spreads"
      mode="iframe"
    />
  );
}

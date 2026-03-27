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
      surfaceKey="borrower_profile"
      dealId={dealId}
      title="Borrower Profile"
      mode="iframe"
    />
  );
}

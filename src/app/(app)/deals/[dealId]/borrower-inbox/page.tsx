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
      surfaceKey="borrower_document_upload_inbox"
      dealId={dealId}
      title="Borrower Document Upload"
      mode="iframe"
    />
  );
}

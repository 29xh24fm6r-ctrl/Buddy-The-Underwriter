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
      surfaceKey="credit_memo_pdf_template"
      dealId={dealId}
      title="Credit Memo Template"
      mode="iframe"
    />
  );
}

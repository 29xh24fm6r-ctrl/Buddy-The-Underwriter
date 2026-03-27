import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <StitchSurface
      surfaceKey="borrower_control_record"
      title="Borrower Control Record"
      mode="iframe"
    />
  );
}

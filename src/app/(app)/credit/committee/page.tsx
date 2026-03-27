import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <StitchSurface
      surfaceKey="credit_committee_view"
      title="Credit Committee"
      mode="iframe"
    />
  );
}

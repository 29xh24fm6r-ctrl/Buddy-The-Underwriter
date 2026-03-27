import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <StitchSurface
      surfaceKey="deals_pipeline_recovery"
      title="Deals Pipeline (Stitch Recovery)"
      mode="iframe"
    />
  );
}

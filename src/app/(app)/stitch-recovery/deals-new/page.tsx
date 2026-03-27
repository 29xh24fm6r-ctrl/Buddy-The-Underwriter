import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <StitchSurface
      surfaceKey="deal_intake_recovery"
      title="Deal Intake (Stitch Recovery)"
      mode="iframe"
    />
  );
}

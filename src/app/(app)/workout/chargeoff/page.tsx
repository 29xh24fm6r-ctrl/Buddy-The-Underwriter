import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <StitchSurface
      surfaceKey="chargeoff_recovery_command_center"
      title="Chargeoff Recovery"
      mode="iframe"
    />
  );
}

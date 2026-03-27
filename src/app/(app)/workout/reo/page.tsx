import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <StitchSurface
      surfaceKey="reo_command_center"
      title="REO Command Center"
      mode="iframe"
    />
  );
}

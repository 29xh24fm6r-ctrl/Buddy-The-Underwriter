import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <StitchSurface
      surfaceKey="pipeline_analytics_command_center"
      title="Pipeline Analytics"
      mode="iframe"
    />
  );
}

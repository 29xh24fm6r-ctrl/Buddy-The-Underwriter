import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <StitchSurface
      surfaceKey="workout_command_center"
      title="Workout Command Center"
      mode="iframe"
    />
  );
}

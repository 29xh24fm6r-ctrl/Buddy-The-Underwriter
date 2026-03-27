import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <StitchSurface
      surfaceKey="workout_case_file"
      title="Workout Case File"
      mode="iframe"
    />
  );
}

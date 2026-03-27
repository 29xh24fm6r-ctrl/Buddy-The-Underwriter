import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <StitchSurface
      surfaceKey="workout_legal_execution_tracker"
      title="Legal Execution Tracker"
      mode="iframe"
    />
  );
}

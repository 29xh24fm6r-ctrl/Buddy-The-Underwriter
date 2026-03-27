import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <StitchSurface
      surfaceKey="exceptions_change_review"
      title="Exceptions Change Review"
      mode="iframe"
    />
  );
}

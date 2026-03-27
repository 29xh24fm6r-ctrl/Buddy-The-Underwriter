import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <StitchSurface
      surfaceKey="stitch_login"
      title="Buddy Login"
      mode="iframe"
    />
  );
}

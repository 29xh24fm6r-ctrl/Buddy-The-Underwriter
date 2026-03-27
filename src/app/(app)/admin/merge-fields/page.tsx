import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <StitchSurface
      surfaceKey="merge_field_registry"
      title="Merge Field Registry"
      mode="iframe"
    />
  );
}

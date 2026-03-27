import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function Page() {
  return (
    <StitchSurface
      surfaceKey="roles_permissions_control"
      title="Roles & Permissions"
      mode="iframe"
    />
  );
}

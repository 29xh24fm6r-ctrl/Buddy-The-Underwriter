import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <StitchSurface surfaceKey="deal_intake" title="Deal Intake" mode="iframe" />;
}

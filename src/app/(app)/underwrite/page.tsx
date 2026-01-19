import { redirect } from "next/navigation";
import StitchSurface from "@/stitch/StitchSurface";

export const dynamic = "force-dynamic";

export default async function UnderwritePage({
  searchParams,
}: {
  searchParams?: { dealId?: string | string[] };
}) {
  const dealIdRaw = searchParams?.dealId;
  const dealId = Array.isArray(dealIdRaw) ? dealIdRaw[0] : dealIdRaw;

  if (dealId) {
    redirect(`/underwrite/${dealId}`);
  }

  return <StitchSurface surfaceKey="underwrite" title="Underwrite" mode="iframe" />;
}

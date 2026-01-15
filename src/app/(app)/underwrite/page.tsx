import { redirect } from "next/navigation";
import StitchRouteBridge from "@/components/stitch/StitchRouteBridge";

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

  return <StitchRouteBridge slug="deals-command-bridge" />;
}

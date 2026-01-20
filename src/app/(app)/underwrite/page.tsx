import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function UnderwritePage({
  searchParams,
}: {
  searchParams?: { dealId?: string | string[] };
}) {
  const dealIdRaw = searchParams?.dealId;
  const dealId = Array.isArray(dealIdRaw) ? dealIdRaw[0] : dealIdRaw;

  if (dealId) {
    redirect(`/deals/${dealId}/underwrite`);
  }

  redirect("/deals");
}

import { redirect } from "next/navigation";

export default async function SpreadsIndex({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  redirect(`/deals/${dealId}/spreads/business`);
}

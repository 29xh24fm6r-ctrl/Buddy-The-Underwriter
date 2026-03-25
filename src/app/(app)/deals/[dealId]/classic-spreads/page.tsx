import { redirect } from "next/navigation";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import ClassicSpreadsClient from "./ClassicSpreadsClient";

type Props = { params: Promise<{ dealId: string }> };

export default async function ClassicSpreadsPage({ params }: Props) {
  const { dealId } = await params;
  const { userId } = await clerkAuth();
  if (!userId) redirect("/sign-in");
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) redirect(`/deals`);
  return <ClassicSpreadsClient dealId={dealId} />;
}

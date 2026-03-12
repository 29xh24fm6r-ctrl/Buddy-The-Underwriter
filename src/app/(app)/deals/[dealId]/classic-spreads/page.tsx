import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/requireRole";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import ClassicSpreadsClient from "./ClassicSpreadsClient";

type Props = { params: Promise<{ dealId: string }> };

export default async function ClassicSpreadsPage({ params }: Props) {
  const { dealId } = await params;
  await requireRole(["super_admin", "bank_admin", "underwriter"]);
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) redirect("/deals");
  return <ClassicSpreadsClient dealId={dealId} />;
}

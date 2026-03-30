/**
 * RETIRED ROUTE — Phase 57C
 * Previously: Stitch "deals_command_bridge" surface
 * Canonical underwriting: /deals/[dealId]/underwrite (AnalystWorkbench)
 */
import { redirect } from "next/navigation";

export default async function Page({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  redirect(`/deals/${dealId}/underwrite`);
}

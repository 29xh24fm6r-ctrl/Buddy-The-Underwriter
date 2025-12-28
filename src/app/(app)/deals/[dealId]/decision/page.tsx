/**
 * /deals/[dealId]/decision - Decision one-pager view
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { DecisionOnePager } from "@/components/decision/DecisionOnePager";
import { redirect } from "next/navigation";

type Props = { params: Promise<{ dealId: string }> };

export default async function DecisionPage({ params }: Props) {
  const { dealId } = await params;
  await getCurrentBankId(); // Tenant check
  const sb = supabaseAdmin();

  // Get latest snapshot
  const { data: snapshot } = await sb
    .from("decision_snapshots")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!snapshot) {
    redirect(`/deals/${dealId}`);
  }

  // Get overrides
  const { data: overrides } = await sb
    .from("decision_overrides")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  return <DecisionOnePager snapshot={snapshot} overrides={overrides || []} />;
}

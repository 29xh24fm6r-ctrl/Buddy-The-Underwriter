/**
 * /deals/[dealId]/decision - Decision one-pager view
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { DecisionOnePager } from "@/components/decision/DecisionOnePager";
import { getAttestationStatus } from "@/lib/decision/attestation";
import { requiresCreditCommittee } from "@/lib/decision/creditCommittee";
import { redirect } from "next/navigation";

type Props = { params: Promise<{ dealId: string }> };

export default async function DecisionPage({ params }: Props) {
  const { dealId } = await params;
  const bankId = await getCurrentBankId(); // Tenant check
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

  // Get attestations for this snapshot
  const { data: attestations } = await sb
    .from("decision_attestations")
    .select("*")
    .eq("decision_snapshot_id", snapshot.id)
    .order("created_at", { ascending: false });

  // Get attestation status (governance check)
  const attestationStatus = await getAttestationStatus(dealId, snapshot.id, bankId);

  // Get credit committee status (policy-driven governance)
  const committeeStatus = await requiresCreditCommittee({
    bankId,
    decisionSnapshot: snapshot
  });

  return (
    <DecisionOnePager
      dealId={dealId}
      snapshot={snapshot}
      overrides={overrides || []}
      attestations={attestations || []}
      attestationStatus={attestationStatus}
      committeeStatus={committeeStatus}
    />
  );
}

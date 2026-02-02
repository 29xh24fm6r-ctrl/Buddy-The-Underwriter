/**
 * /deals/[dealId]/decision - Decision one-pager view
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { DecisionOnePager } from "@/components/decision/DecisionOnePager";
import { getAttestationStatus } from "@/lib/decision/attestation";
import { requiresCreditCommittee } from "@/lib/decision/creditCommittee";
import { ExaminerBanner } from "@/components/examiner/ExaminerBanner";
import { redirect } from "next/navigation";

type Props = { 
  params: Promise<{ dealId: string }>;
  searchParams: Promise<{ examiner?: string }>;
};

export default async function DecisionPage({ params, searchParams }: Props) {
  const { dealId } = await params;
  const { examiner } = await searchParams;
  const isExaminerMode = examiner === "true";
  
  const bankPick = await tryGetCurrentBankId();
  if (!bankPick.ok) redirect("/select-bank");
  const bankId = bankPick.bankId;
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
    <>
      {isExaminerMode && <ExaminerBanner />}
      <DecisionOnePager
        dealId={dealId}
        snapshot={snapshot}
        overrides={overrides || []}
        attestations={attestations || []}
        attestationStatus={attestationStatus}
        committeeStatus={committeeStatus}
        examinerMode={isExaminerMode}
      />
    </>
  );
}

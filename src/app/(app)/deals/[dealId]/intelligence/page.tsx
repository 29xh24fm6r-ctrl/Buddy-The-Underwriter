import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { getOmegaAdvisoryState } from "@/core/omega/OmegaAdvisoryAdapter";
import type { OmegaAdvisoryState } from "@/core/omega/types";
import { OmegaAdvisoryPanel } from "@/components/deal/OmegaAdvisoryPanel";
import IntelligenceClient from "./IntelligenceClient";

type Props = {
  params: Promise<{ dealId: string }>;
};

export default async function IntelligencePage({ params }: Props) {
  const { dealId } = await params;

  // Auth (non-fatal — client handles API auth errors)
  try {
    await ensureDealBankAccess(dealId);
  } catch {
    // non-fatal
  }

  const sb = supabaseAdmin();

  // Fetch audit certificate (most recent)
  let auditConfidence: number | null = null;
  let auditDocCount: number | null = null;
  try {
    const { data } = await (sb as any)
      .from("deal_document_audit_certificates")
      .select("overall_confidence, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      auditConfidence = data.overall_confidence ?? null;
    }
    const { count } = await (sb as any)
      .from("deal_document_audit_certificates")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);
    auditDocCount = count ?? null;
  } catch {
    // non-fatal
  }

  // Fetch total document count
  let totalDocs: number | null = null;
  try {
    const { count } = await (sb as any)
      .from("deal_documents")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);
    totalDocs = count ?? null;
  } catch {
    // non-fatal
  }

  // Fetch Omega advisory state (non-fatal — advisory only)
  let omegaState: OmegaAdvisoryState | null = null;
  try {
    omegaState = await getOmegaAdvisoryState(dealId);
  } catch {
    // non-fatal — Omega is advisory layer only
  }

  // Fetch reconciliation result
  let reconStatus: string | null = null;
  try {
    const { data } = await (sb as any)
      .from("deal_reconciliation_results")
      .select("overall_status")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    reconStatus = data?.overall_status ?? null;
  } catch {
    // non-fatal
  }

  return (
    <div className="space-y-6">
      {/* Omega Advisory — annotation only, never canonical state */}
      {omegaState && <OmegaAdvisoryPanel omega={omegaState} />}

      <IntelligenceClient
        dealId={dealId}
        auditConfidence={auditConfidence}
        auditDocCount={auditDocCount}
        totalDocs={totalDocs}
        reconStatus={reconStatus}
      />
    </div>
  );
}

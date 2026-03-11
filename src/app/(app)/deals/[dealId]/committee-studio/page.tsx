import { supabaseAdmin } from "@/lib/supabase/admin";
import CommitteeStudioClient from "./CommitteeStudioClient";

type Props = {
  params: Promise<{ dealId: string }>;
};

export type CommitteeServerData = {
  auditCerts: Array<{
    id: string;
    document_id: string | null;
    document_name: string | null;
    overall_confidence: number | null;
    corroboration_score: number | null;
    reasonableness_score: number | null;
    identity_status: string | null;
    created_at: string | null;
  }>;
  totalDocCount: number;
  reconciliation: {
    status: string | null;
    check_count: number;
    conflict_count: number;
    last_run_at: string | null;
  };
};

export default async function CommitteeStudioPage({ params }: Props) {
  const { dealId } = await params;
  const sb = supabaseAdmin();

  // Run 3 parallel queries
  const [certResult, docResult, reconResult] = await Promise.all([
    // 1. Audit certificates
    (sb as any)
      .from("deal_document_audit_certificates")
      .select(
        "id, document_id, overall_confidence, corroboration_score, reasonableness_score, identity_status, created_at",
      )
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false }),

    // 2. Total document count
    (sb as any)
      .from("deal_documents")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId),

    // 3. Reconciliation results
    (sb as any)
      .from("deal_reconciliation_results")
      .select("id, status, checks, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // Enrich audit certs with document names
  const certs = certResult.data ?? [];
  const docIds = certs
    .map((r: any) => r.document_id)
    .filter(Boolean);

  let docNames: Record<string, string> = {};
  if (docIds.length > 0) {
    const { data: docs } = await (sb as any)
      .from("deal_documents")
      .select("id, original_filename, document_type")
      .in("id", docIds);
    for (const d of docs ?? []) {
      docNames[d.id] = d.original_filename ?? d.document_type ?? d.id;
    }
  }

  const auditCerts = certs.map((r: any) => ({
    ...r,
    document_name: r.document_id ? (docNames[r.document_id] ?? null) : null,
  }));

  const reconData = reconResult.data;
  const checks = Array.isArray(reconData?.checks) ? reconData.checks : [];
  const conflictCount = checks.filter(
    (c: any) => c.status === "CONFLICT" || c.status === "FLAGS",
  ).length;

  const serverData: CommitteeServerData = {
    auditCerts,
    totalDocCount: docResult.count ?? 0,
    reconciliation: {
      status: reconData?.status ?? null,
      check_count: checks.length,
      conflict_count: conflictCount,
      last_run_at: reconData?.created_at ?? null,
    },
  };

  return <CommitteeStudioClient dealId={dealId} serverData={serverData} />;
}

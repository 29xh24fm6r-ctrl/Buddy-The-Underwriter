import { supabaseAdmin } from "@/lib/supabase/admin";
import RiskClient from "./RiskClient";

type Props = {
  params: Promise<{ dealId: string }>;
};

export type AuditCertRow = {
  id: string;
  document_id: string | null;
  document_name: string | null;
  overall_confidence: number | null;
  corroboration_score: number | null;
  reasonableness_score: number | null;
  identity_status: string | null;
  created_at: string | null;
};

export default async function RiskPage({ params }: Props) {
  const { dealId } = await params;

  let auditCerts: AuditCertRow[] = [];
  try {
    const sb = supabaseAdmin();
    const { data } = await (sb as any)
      .from("deal_document_audit_certificates")
      .select(
        "id, document_id, overall_confidence, corroboration_score, reasonableness_score, identity_status, created_at",
      )
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false });

    // Enrich with document names
    const docIds = (data ?? [])
      .map((r: AuditCertRow) => r.document_id)
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

    auditCerts = (data ?? []).map((r: AuditCertRow) => ({
      ...r,
      document_name: r.document_id ? (docNames[r.document_id] ?? null) : null,
    }));
  } catch {
    // non-fatal
  }

  return <RiskClient dealId={dealId} auditCerts={auditCerts} />;
}

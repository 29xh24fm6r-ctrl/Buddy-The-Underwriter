import "server-only";

/**
 * Phase 56C.1 — Closing Render Snapshot Builder
 *
 * Freezes exact source data used for document generation.
 * Deterministic: same deal state → same snapshot → same checksum.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export type ClosingRenderSnapshot = {
  schemaVersion: "2026-03-56C1";
  generatedAt: string;
  dealId: string;
  closingPackageId: string;
  closingPackageDocumentId: string;
  deal: { id: string; name: string | null; productType: string | null; purpose: string | null };
  borrower: { legalName: string | null; stateOfOrganization: string | null; taxIdMasked: string | null; address: string | null };
  facilities: { amount: number | null; rateType: string | null; maturityDate: string | null; amortization: string | null; paymentFrequency: string | null };
  collateral: { summary: string[]; liens: string[] };
  guarantors: Array<{ name: string; type: string | null }>;
  covenants: Array<{ code: string; label: string; threshold: string | null; frequency: string | null }>;
  secureIdentity: { piiReady: boolean; signerNamesResolved: boolean };
  closingContext: { packageVersion: number; documentCode: string; templateCode: string; templateVersion: string };
};

/**
 * Build a frozen render input snapshot from canonical deal data.
 */
export async function buildClosingRenderSnapshot(opts: {
  dealId: string;
  closingPackageId: string;
  closingPackageDocumentId: string;
  documentCode: string;
  templateCode: string;
  templateVersion: string;
  packageVersion: number;
}): Promise<ClosingRenderSnapshot> {
  const sb = supabaseAdmin();
  const { dealId, closingPackageId, closingPackageDocumentId, documentCode, templateCode, templateVersion, packageVersion } = opts;

  // Load deal
  const { data: deal } = await sb.from("deals").select("id, name, display_name, borrower_name").eq("id", dealId).maybeSingle();

  // Load intake
  const { data: intake } = await sb.from("deal_intake").select("loan_type").eq("deal_id", dealId).maybeSingle();

  // Load loan request
  const { data: lr } = await sb.from("deal_loan_requests").select("requested_amount, product_type, purpose").eq("deal_id", dealId).order("request_number").limit(1).maybeSingle();

  // Load participations
  const { data: parts } = await sb.from("deal_entity_participations").select("role_key, title, guaranty_type").eq("deal_id", dealId);
  const guarantors = (parts ?? []).filter((p: any) => p.role_key === "guarantor").map((p: any) => ({ name: p.title ?? "Guarantor", type: p.guaranty_type ?? null }));

  // Load covenants
  const { data: covs } = await sb.from("deal_covenants").select("metric, threshold, testing_frequency, status").eq("deal_id", dealId);
  const covenants = (covs ?? []).map((c: any) => ({ code: c.metric, label: c.metric, threshold: c.threshold, frequency: c.testing_frequency }));

  // Load collateral
  const { data: collateral } = await sb.from("deal_collateral_items").select("description, collateral_type").eq("deal_id", dealId);
  const collateralSummary = (collateral ?? []).map((c: any) => c.description ?? c.collateral_type ?? "Collateral item");

  // Check PII
  const { count: piiCount } = await sb.from("deal_pii_records").select("id", { count: "exact", head: true }).eq("deal_id", dealId);

  return {
    schemaVersion: "2026-03-56C1",
    generatedAt: new Date().toISOString(),
    dealId,
    closingPackageId,
    closingPackageDocumentId,
    deal: {
      id: dealId,
      name: (deal as any)?.display_name ?? (deal as any)?.name ?? null,
      productType: (intake as any)?.loan_type ?? (lr as any)?.product_type ?? null,
      purpose: (lr as any)?.purpose ?? null,
    },
    borrower: {
      legalName: (deal as any)?.borrower_name ?? null,
      stateOfOrganization: null,
      taxIdMasked: null,
      address: null,
    },
    facilities: {
      amount: (lr as any)?.requested_amount ?? null,
      rateType: null,
      maturityDate: null,
      amortization: null,
      paymentFrequency: null,
    },
    collateral: { summary: collateralSummary, liens: [] },
    guarantors,
    covenants,
    secureIdentity: { piiReady: (piiCount ?? 0) > 0, signerNamesResolved: guarantors.length > 0 },
    closingContext: { packageVersion, documentCode, templateCode, templateVersion },
  };
}

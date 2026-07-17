import "server-only";

/**
 * Lead qualification domain service — SPEC-BROKERAGE-OPERATING-SYSTEM-V1
 * PR2 §4.2.
 *
 * A structured pre-underwriting record, deliberately distinct from the
 * deal's eventual underwriting facts (borrower-stated numbers here are
 * never treated as verified). Each field's confidence is tracked
 * separately in `field_provenance` so the UI/downstream logic can tell
 * "the borrower said $2M revenue" apart from "we verified $2M revenue".
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";

export const PROVENANCE_STATES = [
  "unknown",
  "borrower_stated",
  "document_supported",
  "verified",
  "conflicting",
  "not_applicable",
] as const;

export type ProvenanceState = (typeof PROVENANCE_STATES)[number];

export const QUALIFICATION_FIELDS = [
  "use_of_proceeds",
  "business_age_years",
  "deal_type",
  "ownership_structure",
  "owner_citizenship_state",
  "credit_estimate",
  "liquidity_estimate",
  "equity_injection_available",
  "annual_revenue_estimate",
  "cash_flow_estimate",
  "debt_obligations_notes",
  "collateral_notes",
  "industry",
  "naics_code",
  "franchise_status",
  "geographic_location",
  "time_sensitivity",
  "existing_lender_discussions",
  "known_eligibility_concerns",
] as const;

export type QualificationField = (typeof QUALIFICATION_FIELDS)[number];

export type LeadQualification = {
  id: string;
  bank_id: string;
  lead_id: string;
  use_of_proceeds: string | null;
  business_age_years: number | null;
  deal_type: "startup" | "acquisition" | "expansion" | "refinance" | "other" | null;
  ownership_structure: string | null;
  owner_citizenship_state: string | null;
  credit_estimate: string | null;
  liquidity_estimate: number | null;
  equity_injection_available: number | null;
  annual_revenue_estimate: number | null;
  cash_flow_estimate: number | null;
  debt_obligations_notes: string | null;
  collateral_notes: string | null;
  industry: string | null;
  naics_code: string | null;
  franchise_status: "franchise" | "independent" | "unknown" | null;
  geographic_location: string | null;
  time_sensitivity: string | null;
  existing_lender_discussions: string | null;
  known_eligibility_concerns: string | null;
  field_provenance: Partial<Record<QualificationField, ProvenanceState>>;
  created_by_clerk_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type UpsertQualificationInput = {
  bankId: string;
  leadId: string;
  createdByClerkUserId?: string | null;
  fields: Partial<Record<QualificationField, unknown>>;
  provenance?: Partial<Record<QualificationField, ProvenanceState>>;
};

/** Fields never treated as verified unless staff explicitly marks them so. */
export function fieldProvenance(q: LeadQualification, field: QualificationField): ProvenanceState {
  return q.field_provenance?.[field] ?? "unknown";
}

export function isFieldVerified(q: LeadQualification, field: QualificationField): boolean {
  return fieldProvenance(q, field) === "verified" || fieldProvenance(q, field) === "document_supported";
}

export async function getQualification(bankId: string, leadId: string, sb: SB = supabaseAdmin()): Promise<LeadQualification | null> {
  const { data, error } = await sb
    .from("brokerage_lead_qualifications")
    .select("*")
    .eq("bank_id", bankId)
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error) throw new Error(`getQualification failed: ${error.message}`);
  return (data as LeadQualification) ?? null;
}

export async function upsertQualification(input: UpsertQualificationInput, sb: SB = supabaseAdmin()): Promise<LeadQualification> {
  const existing = await getQualification(input.bankId, input.leadId, sb);

  const patch: Record<string, unknown> = { ...input.fields };
  if (input.provenance) {
    const mergedProvenance = { ...(existing?.field_provenance ?? {}), ...input.provenance };
    patch.field_provenance = mergedProvenance;
  }

  if (existing) {
    const { data, error } = await sb
      .from("brokerage_lead_qualifications")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(`upsertQualification update failed: ${error.message}`);
    return data as LeadQualification;
  }

  const { data, error } = await sb
    .from("brokerage_lead_qualifications")
    .insert({
      bank_id: input.bankId,
      lead_id: input.leadId,
      created_by_clerk_user_id: input.createdByClerkUserId ?? null,
      ...patch,
    })
    .select("*")
    .single();
  if (error) throw new Error(`upsertQualification insert failed: ${error.message}`);
  return data as LeadQualification;
}

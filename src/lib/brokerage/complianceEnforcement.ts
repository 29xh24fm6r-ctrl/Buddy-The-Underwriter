/**
 * BRK-10F Compliance Enforcement — seal/unlock guards.
 */
import { buildForm159PayloadForDeal, tryRenderForm159Pdf } from "@/lib/brokerage/compliancePackage";

export type ComplianceBlocker = { code: string; severity: "critical" | "warning"; message: string; action: string };
export type SealComplianceResult = { ok: true } | { ok: false; blockers: ComplianceBlocker[] };
export type UnlockComplianceResult = { ok: true } | { ok: false; blockers: ComplianceBlocker[] };
type Row = Record<string, any>;
// storage is optional — see compliancePackage.ts SB for why (test fakes vs. real client).
type SB = { from: (t: string) => any; storage?: { from: (bucket: string) => any } };
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function b(code: string, sev: "critical"|"warning", msg: string, action: string): ComplianceBlocker { return { code, severity: sev, message: msg, action }; }

export async function assertCanSealBrokeragePackage(dealId: string, sb: SB): Promise<SealComplianceResult> {
  const blockers: ComplianceBlocker[] = [];
  const { data: disc } = await sb.from("brokerage_disclosures").select("disclosure_type, status").eq("deal_id", dealId);
  const ack = new Set(((disc ?? []) as Row[]).filter(d => str(d.status) === "acknowledged").map(d => str(d.disclosure_type)));
  if (!ack.has("borrower_engagement_letter")) blockers.push(b("missing_engagement_ack", "critical", "Engagement letter not acknowledged", "Present and collect ack"));
  if (!ack.has("fee_disclosure")) blockers.push(b("missing_fee_disclosure_ack", "critical", "Fee disclosure not acknowledged", "Present and collect ack"));
  const { data: fees } = await sb.from("brokerage_fee_ledger").select("fee_type, status").eq("deal_id", dealId);
  const af = ((fees ?? []) as Row[]).filter(f => !["waived", "cancelled"].includes(str(f.status) ?? ""));
  const ft = new Set(af.map(f => str(f.fee_type)));
  if (!ft.has("borrower_packaging") && !((fees ?? []) as Row[]).some(f => str(f.fee_type) === "borrower_packaging" && str(f.status) === "waived"))
    blockers.push(b("missing_borrower_fee_ledger", "critical", "Borrower fee ledger missing", "Create fee ledger"));
  const { data: f159 } = await sb.from("sba_form_159_records").select("status").eq("deal_id", dealId).in("status", ["generated", "borrower_acknowledged", "fully_acknowledged", "locked"]).limit(1).maybeSingle();
  if (!f159) blockers.push(b("missing_form_159", "critical", "Form 159 not generated", "Generate Form 159"));
  if (ft.has("borrower_packaging") && ft.has("lender_referral") && !ack.has("two_masters_consent"))
    blockers.push(b("missing_two_masters_consent", "critical", "Two-masters consent required", "Present consent"));
  return blockers.length === 0 ? { ok: true } : { ok: false, blockers };
}

export async function assertCanUnlockBrokeragePackage(dealId: string, lenderBankId: string, claimId: string, sb: SB): Promise<UnlockComplianceResult> {
  const blockers: ComplianceBlocker[] = [];
  const { data: sp } = await sb.from("buddy_sealed_packages").select("id").eq("deal_id", dealId).is("unsealed_at", null).limit(1).maybeSingle();
  if (!sp) blockers.push(b("no_sealed_package", "critical", "No sealed package", "Seal first"));
  const { data: cl } = await sb.from("marketplace_claims").select("id, status").eq("id", claimId).maybeSingle();
  if (!cl || str(cl.status) !== "picked") blockers.push(b("claim_not_picked", "critical", "Claim not picked", "Borrower must pick"));
  const { data: agr } = await sb.from("lender_marketplace_agreements").select("id").eq("lender_bank_id", lenderBankId).eq("status", "active").limit(1).maybeSingle();
  if (!agr) blockers.push(b("no_active_lender_agreement", "critical", "No active agreement", "Activate agreement"));
  const { data: lf } = await sb.from("brokerage_fee_ledger").select("id, status, disclosed_on_form_159").eq("deal_id", dealId).eq("fee_type", "lender_referral").limit(1).maybeSingle();
  if (!lf) { const { data: wf } = await sb.from("brokerage_fee_ledger").select("id").eq("deal_id", dealId).eq("fee_type", "lender_referral").eq("status", "waived").limit(1).maybeSingle(); if (!wf) blockers.push(b("missing_lender_fee_ledger", "critical", "Lender fee missing", "Create fee ledger")); }
  else if (!lf.disclosed_on_form_159 && str(lf.status) !== "waived") blockers.push(b("lender_fee_not_disclosed", "critical", "Fee not on Form 159", "Update Form 159"));
  const { data: f159 } = await sb.from("sba_form_159_records").select("status").eq("deal_id", dealId).in("status", ["borrower_acknowledged", "fully_acknowledged", "locked"]).limit(1).maybeSingle();
  if (!f159) blockers.push(b("form_159_not_acknowledged", "critical", "Form 159 not ack'd", "Collect ack"));
  return blockers.length === 0 ? { ok: true } : { ok: false, blockers };
}

export async function buildComplianceBlockers(dealId: string, sb: SB): Promise<ComplianceBlocker[]> { const r = await assertCanSealBrokeragePackage(dealId, sb); return r.ok ? [] : r.blockers; }
export async function ensureForm159ForPickedLender(dealId: string, lenderBankId: string, sb: SB): Promise<{ ok: boolean; recordId?: string; error?: string }> {
  const { data: ex } = await sb.from("sba_form_159_records").select("id, status, lender_bank_id").eq("deal_id", dealId).in("status", ["draft", "generated", "borrower_acknowledged", "fully_acknowledged"]).limit(1).maybeSingle();
  if (ex && str(ex.status) === "locked") return { ok: false, error: "form_159_locked" };
  if (ex) {
    if (str(ex.lender_bank_id) !== lenderBankId) {
      const { fields } = await buildForm159PayloadForDeal(dealId, sb, lenderBankId);
      const pdfPath = await tryRenderForm159Pdf(dealId, sb, fields);
      await sb.from("sba_form_159_records").update({ lender_bank_id: lenderBankId, generated_payload: fields, ...(pdfPath ? { generated_pdf_path: pdfPath } : {}) }).eq("id", ex.id);
    }
    return { ok: true, recordId: String(ex.id) };
  }
  const { fields } = await buildForm159PayloadForDeal(dealId, sb, lenderBankId);
  const pdfPath = await tryRenderForm159Pdf(dealId, sb, fields);
  const { data: ins, error } = await sb.from("sba_form_159_records").insert({ deal_id: dealId, status: "generated", lender_bank_id: lenderBankId, borrower_fee_cents: 100000, generated_at: new Date().toISOString(), generated_payload: fields, generated_pdf_path: pdfPath }).select("id").single();
  return ins ? { ok: true, recordId: String(ins.id) } : { ok: false, error: error?.message ?? "insert_failed" };
}
export async function markLenderFeeDisclosedForUnlock(dealId: string, _lenderBankId: string, sb: SB): Promise<void> {
  await sb.from("brokerage_fee_ledger").update({ disclosed_on_form_159: true, status: "disclosed" }).eq("deal_id", dealId).eq("fee_type", "lender_referral");
}

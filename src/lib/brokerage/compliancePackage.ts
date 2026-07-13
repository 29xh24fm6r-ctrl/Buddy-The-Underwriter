/**
 * BRK-10E Compliance Package — fees, disclosures, Form 159, consent trail.
 */
import { buildSbaForm159, type Sba159FeeLedgerRow, type Sba159Fields } from "@/lib/sba/forms/build159";

export type FeeConfig = { id: string; version: string; status: string; borrowerPackagingFeeCents: number; borrowerPackagingFeeLabel: string; lenderReferralFeeMinBps: number; lenderReferralFeeMaxBps: number; financedIntoLoanDefault: boolean };
export type ComplianceStatus = { borrowerEngagementAcknowledged: boolean; feeDisclosureAcknowledged: boolean; form159PreviewGenerated: boolean; twoMastersConsentRequired: boolean; twoMastersConsentAcknowledged: boolean; complianceReadyToSeal: boolean; feeLedgerStatus: string | null; issues: string[] };
export type ComplianceCheckResult = { ok: boolean; feeConfig: FeeConfig | null; legalTemplatesPresent: boolean; form159GeneratorPresent: boolean; issues: string[]; elapsed: number };
type Row = Record<string, any>;
// `storage` is optional: unit tests pass a lightweight in-memory fake with
// only `.from()`, so PDF rendering is skipped there. A real supabaseAdmin()
// client (production) has `.storage`, so the render step runs live.
type SB = { from: (t: string) => any; storage?: { from: (bucket: string) => any } };

/**
 * Best-effort: renders the official 159 PDF (if the template has been
 * ingested and `sb` is a real Supabase client with storage) and returns the
 * storage path, or null if the template isn't available yet / sb can't do
 * storage I/O. Never throws — a render failure must not block saving the
 * real JSON payload, which is the primary compliance artifact.
 */
export async function tryRenderForm159Pdf(dealId: string, sb: SB, fields: Sba159Fields): Promise<string | null> {
  if (!sb.storage) return null;
  try {
    // Dynamic import: render159.ts pulls in pdf-lib + "server-only" through
    // pdfFill.ts. Loading it eagerly at module scope would break the plain
    // `node --test` harness (no react-server condition) for every caller of
    // this file, even ones that never touch a real storage-capable client.
    const { renderForm159Pdf } = await import("@/lib/sba/forms/render159");
    const result = await renderForm159Pdf({ supabase: sb as any, dealId, fields });
    return result.ok ? result.storagePath : null;
  } catch {
    return null;
  }
}
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
const DEF: FeeConfig = { id: "default", version: "v1", status: "active", borrowerPackagingFeeCents: 100000, borrowerPackagingFeeLabel: "SBA loan packaging fee", lenderReferralFeeMinBps: 100, lenderReferralFeeMaxBps: 200, financedIntoLoanDefault: true };

export async function getActiveFeeConfig(sb: SB): Promise<FeeConfig> {
  const { data } = await sb.from("brokerage_fee_config").select("*").eq("status", "active").limit(1).maybeSingle();
  if (!data) return DEF;
  return { id: String(data.id), version: str(data.version) ?? "v1", status: "active", borrowerPackagingFeeCents: num(data.borrower_packaging_fee_cents) ?? 100000, borrowerPackagingFeeLabel: str(data.borrower_packaging_fee_label) ?? DEF.borrowerPackagingFeeLabel, lenderReferralFeeMinBps: num(data.lender_referral_fee_min_bps) ?? 100, lenderReferralFeeMaxBps: num(data.lender_referral_fee_max_bps) ?? 200, financedIntoLoanDefault: data.financed_into_loan_default !== false };
}

export async function buildBorrowerEngagementDisclosure(dealId: string, sb: SB): Promise<{ bodyMd: string; version: string }> {
  const { data: t } = await sb.from("legal_documents").select("body_md, version").eq("document_type", "borrower_engagement_letter").eq("status", "active").limit(1).maybeSingle();
  const c = await getActiveFeeConfig(sb); const fee = `$${(c.borrowerPackagingFeeCents / 100).toLocaleString()}`;
  return { bodyMd: t?.body_md ? String(t.body_md).replace(/\$1,000/g, fee) : `Engagement for deal ${dealId}. Fee: ${fee}.`, version: str(t?.version) ?? "v1" };
}

export async function presentDisclosure(args: { dealId: string; disclosureType: string; bodyMd: string; version: string; sessionTokenHash?: string; sb: SB }): Promise<{ id: string }> {
  const { data, error } = await args.sb.from("brokerage_disclosures").insert({ deal_id: args.dealId, disclosure_type: args.disclosureType, version: args.version, body_md: args.bodyMd, status: "presented", borrower_session_token_hash: args.sessionTokenHash ?? null, presented_at: new Date().toISOString() }).select("id").single();
  if (error || !data) throw new Error(`presentDisclosure: ${error?.message ?? "no data"}`);
  return { id: String(data.id) };
}

export async function acknowledgeDisclosure(args: { disclosureId: string; name: string; email: string; ipAddress?: string; userAgent?: string; sb: SB }): Promise<void> {
  await args.sb.from("brokerage_disclosures").update({ status: "acknowledged", acknowledged_at: new Date().toISOString(), acknowledged_by_name: args.name, acknowledged_by_email: args.email, ip_address: args.ipAddress ?? null, user_agent: args.userAgent ?? null }).eq("id", args.disclosureId);
}

export async function estimateBorrowerPackagingFee(dealId: string, sb: SB): Promise<{ amountCents: number; label: string }> { const c = await getActiveFeeConfig(sb); return { amountCents: c.borrowerPackagingFeeCents, label: c.borrowerPackagingFeeLabel }; }

export async function estimateLenderReferralFee(dealId: string, lenderBankId: string, sb: SB): Promise<{ bps: number; estimatedCents: number | null }> {
  const { data: agr } = await sb.from("lender_marketplace_agreements").select("referral_fee_bps").eq("lender_bank_id", lenderBankId).eq("status", "active").limit(1).maybeSingle();
  const bps = num(agr?.referral_fee_bps) ?? 100;
  const { data: deal } = await sb.from("deals").select("loan_amount").eq("id", dealId).maybeSingle();
  const la = num(deal?.loan_amount); return { bps, estimatedCents: la != null ? Math.round(la * bps / 100) : null };
}

export async function createOrUpdateFeeLedgerForDeal(dealId: string, sb: SB): Promise<{ borrowerEntry: any; lenderEntry: any }> {
  const c = await getActiveFeeConfig(sb);
  const { data: eb } = await sb.from("brokerage_fee_ledger").select("*").eq("deal_id", dealId).eq("fee_type", "borrower_packaging").limit(1).maybeSingle();
  let be = eb; if (!eb) { const { data: ins } = await sb.from("brokerage_fee_ledger").insert({ deal_id: dealId, fee_type: "borrower_packaging", payer_type: "borrower", amount_cents: c.borrowerPackagingFeeCents, status: "estimated" }).select("*").single(); be = ins; }
  const { data: pick } = await sb.from("marketplace_picks").select("picked_lender_bank_id").eq("deal_id", dealId).eq("status", "picked").limit(1).maybeSingle();
  let le = null; if (pick?.picked_lender_bank_id) { const { data: el } = await sb.from("brokerage_fee_ledger").select("*").eq("deal_id", dealId).eq("fee_type", "lender_referral").limit(1).maybeSingle(); if (!el) { const { bps, estimatedCents } = await estimateLenderReferralFee(dealId, String(pick.picked_lender_bank_id), sb); const { data: ins } = await sb.from("brokerage_fee_ledger").insert({ deal_id: dealId, fee_type: "lender_referral", payer_type: "lender", amount_cents: estimatedCents, bps, status: "estimated" }).select("*").single(); le = ins; } else le = el; }
  return { borrowerEntry: be, lenderEntry: le };
}

/**
 * Builds the full SBA Form 159 field payload for a deal: applicant identity
 * from `deals`, itemized fees from `brokerage_fee_ledger`, and the picked
 * lender's name (if any). ARC-00 Phase 0.D — replaces the `{}` placeholder
 * that used to be written at generation time.
 */
export async function buildForm159PayloadForDeal(dealId: string, sb: SB, lenderBankId: string | null) {
  const [{ data: deal }, { data: feeRows }, lenderRow] = await Promise.all([
    sb.from("deals").select("borrower_name, name, loan_amount").eq("id", dealId).maybeSingle(),
    sb.from("brokerage_fee_ledger").select("fee_type, payer_type, payee_type, amount_cents, bps, basis_amount_cents, status").eq("deal_id", dealId),
    lenderBankId ? sb.from("banks").select("name").eq("id", lenderBankId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const d = (deal ?? {}) as Row;
  const { fields, missing } = buildSbaForm159({
    dealId,
    applicantName: str(d.borrower_name) ?? str(d.name),
    loanAmount: num(d.loan_amount),
    lenderBankId,
    lenderBankName: str((lenderRow as { data: Row | null }).data?.name ?? null),
    feeLedger: ((feeRows ?? []) as Row[]).map((f) => ({
      fee_type: String(f.fee_type),
      payer_type: String(f.payer_type),
      payee_type: String(f.payee_type),
      amount_cents: num(f.amount_cents),
      bps: num(f.bps),
      basis_amount_cents: num(f.basis_amount_cents),
      status: String(f.status),
    })) as Sba159FeeLedgerRow[],
  });
  return { fields, missing };
}

export async function generateForm159Preview(dealId: string, sb: SB, lenderBankId?: string): Promise<{ id: string; status: string; borrowerFeeCents: number; lenderReferralFeeBps: number | null; lenderReferralFeeEstimatedCents: number | null }> {
  const c = await getActiveFeeConfig(sb); let lbid = lenderBankId ?? null; let lbps: number | null = null; let lest: number | null = null;
  if (!lbid) { const { data: pick } = await sb.from("marketplace_picks").select("picked_lender_bank_id").eq("deal_id", dealId).eq("status", "picked").limit(1).maybeSingle(); lbid = pick?.picked_lender_bank_id ? String(pick.picked_lender_bank_id) : null; }
  if (lbid) { const e = await estimateLenderReferralFee(dealId, lbid, sb); lbps = e.bps; lest = e.estimatedCents; }
  const { fields: generatedPayload } = await buildForm159PayloadForDeal(dealId, sb, lbid);
  const generatedPdfPath = await tryRenderForm159Pdf(dealId, sb, generatedPayload);
  const { data: ex } = await sb.from("sba_form_159_records").select("*").eq("deal_id", dealId).in("status", ["draft", "generated"]).limit(1).maybeSingle();
  if (ex && str(ex.status) !== "locked") { await sb.from("sba_form_159_records").update({ borrower_fee_cents: c.borrowerPackagingFeeCents, lender_referral_fee_bps: lbps, lender_referral_fee_estimated_cents: lest, lender_bank_id: lbid, status: "generated", generated_at: new Date().toISOString(), generated_payload: generatedPayload, ...(generatedPdfPath ? { generated_pdf_path: generatedPdfPath } : {}) }).eq("id", ex.id); return { id: String(ex.id), status: "generated", borrowerFeeCents: c.borrowerPackagingFeeCents, lenderReferralFeeBps: lbps, lenderReferralFeeEstimatedCents: lest }; }
  const { data: ins } = await sb.from("sba_form_159_records").insert({ deal_id: dealId, borrower_fee_cents: c.borrowerPackagingFeeCents, lender_referral_fee_bps: lbps, lender_referral_fee_estimated_cents: lest, lender_bank_id: lbid, generated_at: new Date().toISOString(), status: "generated", generated_payload: generatedPayload, generated_pdf_path: generatedPdfPath }).select("*").single();
  return { id: String(ins?.id ?? ""), status: "generated", borrowerFeeCents: c.borrowerPackagingFeeCents, lenderReferralFeeBps: lbps, lenderReferralFeeEstimatedCents: lest };
}

export async function lockForm159Record(recordId: string, sb: SB): Promise<{ ok: boolean; error?: string }> {
  const { data } = await sb.from("sba_form_159_records").select("status").eq("id", recordId).maybeSingle();
  if (!data) return { ok: false, error: "record_not_found" }; if (str(data.status) === "locked") return { ok: true }; if (str(data.status) === "voided") return { ok: false, error: "record_voided" };
  await sb.from("sba_form_159_records").update({ status: "locked", locked_at: new Date().toISOString() }).eq("id", recordId); return { ok: true };
}

export async function assertDealComplianceReady(dealId: string, sb: SB): Promise<ComplianceStatus> {
  const issues: string[] = [];
  const { data: disc } = await sb.from("brokerage_disclosures").select("disclosure_type, status").eq("deal_id", dealId);
  const ack = new Set(((disc ?? []) as Row[]).filter(d => str(d.status) === "acknowledged").map(d => str(d.disclosure_type)));
  const ea = ack.has("borrower_engagement_letter"); const fa = ack.has("fee_disclosure"); const tma = ack.has("two_masters_consent");
  if (!ea) issues.push("Borrower engagement letter not acknowledged"); if (!fa) issues.push("Fee disclosure not acknowledged");
  const { data: f159 } = await sb.from("sba_form_159_records").select("status").eq("deal_id", dealId).in("status", ["generated", "borrower_acknowledged", "fully_acknowledged", "locked"]).limit(1).maybeSingle();
  if (!f159) issues.push("Form 159 preview not generated");
  const { data: fees } = await sb.from("brokerage_fee_ledger").select("fee_type, status").eq("deal_id", dealId);
  const ft = new Set(((fees ?? []) as Row[]).filter(f => !["waived", "cancelled"].includes(str(f.status) ?? "")).map(f => str(f.fee_type)));
  const tmr = ft.has("borrower_packaging") && ft.has("lender_referral");
  if (tmr && !tma) issues.push("Two-masters consent required but not acknowledged");
  const af = ((fees ?? []) as Row[]).filter(f => !["waived", "cancelled"].includes(str(f.status) ?? ""));
  return { borrowerEngagementAcknowledged: ea, feeDisclosureAcknowledged: fa, form159PreviewGenerated: Boolean(f159), twoMastersConsentRequired: tmr, twoMastersConsentAcknowledged: tma, complianceReadyToSeal: issues.length === 0, feeLedgerStatus: af.length > 0 ? af.map(f => `${f.fee_type}:${f.status}`).join(", ") : null, issues };
}

export async function runComplianceCheck(sb: SB): Promise<ComplianceCheckResult> {
  const start = Date.now(); const issues: string[] = [];
  let fc: FeeConfig | null = null; try { fc = await getActiveFeeConfig(sb); if (fc.id === "default") issues.push("No active fee config in DB"); } catch { issues.push("Failed to load fee config"); }
  const { data: templates } = await sb.from("legal_documents").select("document_type, status").eq("status", "active");
  const at = new Set(((templates ?? []) as Row[]).map(t => str(t.document_type)));
  const missing = ["borrower_engagement_letter", "lender_marketplace_agreement", "fee_disclosure", "form_159_preview_notice", "two_masters_consent"].filter(t => !at.has(t));
  if (missing.length > 0) issues.push(`Missing templates: ${missing.join(", ")}`);
  return { ok: issues.length === 0, feeConfig: fc, legalTemplatesPresent: missing.length === 0, form159GeneratorPresent: true, issues, elapsed: Date.now() - start };
}

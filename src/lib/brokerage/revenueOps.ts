/**
 * BRK-10I Revenue Ops — funding verification, fee calculation, reconciliation.
 */
export type FundingInput = { fundedAmountCents: number; fundedAt: string; verificationSource: string; verifiedByScope: string; verifiedById?: string; metadata?: Record<string, any> };
export type RevenueSummary = { dealId: string; funded: boolean; fundedAmountCents: number | null; borrowerPackagingFeeCents: number | null; borrowerFeeStatus: string | null; lenderReferralFeeCents: number | null; lenderReferralFeeBps: number | null; lenderFeeStatus: string | null; totalRevenueCents: number; revenueEventCount: number; issues: string[] };
export type ReconciliationResult = { fundedDeals: number; missingVerification: number; feeLedgerMismatches: number; revenueEventCount: number; totalBorrowerFees: number; totalLenderFees: number; criticalIssues: string[] };
type Row = Record<string, any>;
type SB = { from: (t: string) => any };
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function now(): string { return new Date().toISOString(); }
async function emitRE(sb: SB, dealId: string, eventType: string, opts?: { feeLedgerId?: string; amountCents?: number; source?: string; metadata?: Record<string, any> }) { await sb.from("brokerage_revenue_events").insert({ deal_id: dealId, fee_ledger_id: opts?.feeLedgerId ?? null, event_type: eventType, amount_cents: opts?.amountCents ?? null, source: opts?.source ?? "system", metadata: opts?.metadata ?? {} }); }

export async function verifyDealFunding(dealId: string, input: FundingInput, sb: SB): Promise<{ ok: true; verificationId: string; idempotent: boolean } | { ok: false; error: string }> {
  const { data: ex } = await sb.from("brokerage_funding_verifications").select("id").eq("deal_id", dealId).eq("status", "verified").limit(1).maybeSingle();
  if (ex) return { ok: true, verificationId: String(ex.id), idempotent: true };
  const { data: wf } = await sb.from("brokerage_closing_workflows").select("id, lender_bank_id").eq("deal_id", dealId).in("status", ["clear_to_close", "funded"]).limit(1).maybeSingle();
  const { data: ins, error } = await sb.from("brokerage_funding_verifications").insert({ deal_id: dealId, workflow_id: wf?.id ?? null, lender_bank_id: str(wf?.lender_bank_id), funded_amount_cents: input.fundedAmountCents, funded_at: input.fundedAt, verification_source: input.verificationSource, verified_by_scope: input.verifiedByScope, verified_by_id: input.verifiedById ?? null, status: "verified", metadata: input.metadata ?? {} }).select("id").single();
  if (error || !ins) return { ok: false, error: error?.message ?? "insert_failed" };
  await emitRE(sb, dealId, "funding_verified", { amountCents: input.fundedAmountCents, source: "funding_verification", metadata: { verification_id: String(ins.id) } });
  return { ok: true, verificationId: String(ins.id), idempotent: false };
}

export async function calculateFinalBorrowerPackagingFee(dealId: string, sb: SB): Promise<{ amountCents: number; waived: boolean }> {
  const { data } = await sb.from("brokerage_fee_ledger").select("amount_cents, status").eq("deal_id", dealId).eq("fee_type", "borrower_packaging").limit(1).maybeSingle();
  if (data && str(data.status) === "waived") return { amountCents: 0, waived: true };
  return { amountCents: num(data?.amount_cents) ?? 100000, waived: false };
}

export async function calculateFinalLenderReferralFee(dealId: string, lenderBankId: string, fundedAmountCents: number, sb: SB): Promise<{ bps: number; amountCents: number; waived: boolean }> {
  const { data: entry } = await sb.from("brokerage_fee_ledger").select("bps, status").eq("deal_id", dealId).eq("fee_type", "lender_referral").limit(1).maybeSingle();
  if (entry && str(entry.status) === "waived") return { bps: 0, amountCents: 0, waived: true };
  const { data: cl } = await sb.from("marketplace_claims").select("committed_rate_bps").eq("deal_id", dealId).eq("lender_bank_id", lenderBankId).eq("status", "picked").limit(1).maybeSingle();
  let bps = num(cl?.committed_rate_bps);
  if (bps == null) { const { data: agr } = await sb.from("lender_marketplace_agreements").select("referral_fee_bps").eq("lender_bank_id", lenderBankId).eq("status", "active").limit(1).maybeSingle(); bps = num(agr?.referral_fee_bps) ?? 100; }
  return { bps, amountCents: Math.round(fundedAmountCents * bps / 10000), waived: false };
}

export async function markFeesEarned(dealId: string, verificationId: string, sb: SB): Promise<{ updated: number }> {
  const { data } = await sb.from("brokerage_fee_ledger").select("id, fee_type, amount_cents, status").eq("deal_id", dealId).in("status", ["estimated", "disclosed"]);
  let u = 0; for (const e of (data ?? []) as Row[]) { await sb.from("brokerage_fee_ledger").update({ status: "earned" }).eq("id", e.id); await emitRE(sb, dealId, "fee_earned", { feeLedgerId: String(e.id), amountCents: num(e.amount_cents) ?? undefined, source: "fee_ledger", metadata: { verification_id: verificationId, fee_type: str(e.fee_type) } }); u++; }
  return { updated: u };
}

export async function markFeesFunded(dealId: string, verificationId: string, sb: SB): Promise<{ updated: number }> {
  const { data } = await sb.from("brokerage_fee_ledger").select("id, fee_type, amount_cents, status").eq("deal_id", dealId).in("status", ["earned"]);
  let u = 0; for (const e of (data ?? []) as Row[]) { await sb.from("brokerage_fee_ledger").update({ status: "funded", funding_verified_at: now() }).eq("id", e.id); await emitRE(sb, dealId, "fee_funded", { feeLedgerId: String(e.id), amountCents: num(e.amount_cents) ?? undefined, source: "fee_ledger", metadata: { verification_id: verificationId, fee_type: str(e.fee_type) } }); u++; }
  return { updated: u };
}

export async function createRevenueEventsForFunding(dealId: string, verificationId: string, fundedAmountCents: number, lenderBankId: string, sb: SB): Promise<void> {
  const { bps, amountCents, waived } = await calculateFinalLenderReferralFee(dealId, lenderBankId, fundedAmountCents, sb);
  if (!waived) await sb.from("brokerage_fee_ledger").update({ amount_cents: amountCents, bps, basis_amount_cents: fundedAmountCents }).eq("deal_id", dealId).eq("fee_type", "lender_referral");
  await markFeesEarned(dealId, verificationId, sb); await markFeesFunded(dealId, verificationId, sb);
}

export async function getRevenueSummary(dealId: string, sb: SB): Promise<RevenueSummary> {
  const issues: string[] = [];
  const { data: v } = await sb.from("brokerage_funding_verifications").select("funded_amount_cents, status").eq("deal_id", dealId).eq("status", "verified").limit(1).maybeSingle();
  const funded = Boolean(v);
  const { data: fees } = await sb.from("brokerage_fee_ledger").select("fee_type, amount_cents, bps, status").eq("deal_id", dealId);
  const fr = (fees ?? []) as Row[]; const bf = fr.find(f => str(f.fee_type) === "borrower_packaging"); const lf = fr.find(f => str(f.fee_type) === "lender_referral");
  const bc = bf && !["waived", "cancelled"].includes(str(bf.status) ?? "") ? num(bf.amount_cents) ?? 0 : 0;
  const lc = lf && !["waived", "cancelled"].includes(str(lf.status) ?? "") ? num(lf.amount_cents) ?? 0 : 0;
  if (funded && !bf) issues.push("Missing borrower fee"); if (funded && !lf) issues.push("Missing lender fee");
  if (funded && bf && !["funded", "waived"].includes(str(bf.status) ?? "")) issues.push(`Borrower fee "${bf.status}" not funded`);
  if (funded && lf && !["funded", "waived"].includes(str(lf.status) ?? "")) issues.push(`Lender fee "${lf.status}" not funded`);
  const { data: evs } = await sb.from("brokerage_revenue_events").select("id").eq("deal_id", dealId);
  return { dealId, funded, fundedAmountCents: num(v?.funded_amount_cents), borrowerPackagingFeeCents: num(bf?.amount_cents), borrowerFeeStatus: str(bf?.status), lenderReferralFeeCents: num(lf?.amount_cents), lenderReferralFeeBps: num(lf?.bps), lenderFeeStatus: str(lf?.status), totalRevenueCents: bc + lc, revenueEventCount: ((evs ?? []) as Row[]).length, issues };
}

export async function runRevenueReconciliation(sb: SB): Promise<ReconciliationResult> {
  const ci: string[] = [];
  const { data: wfs } = await sb.from("brokerage_closing_workflows").select("deal_id").eq("status", "funded");
  const fdi = ((wfs ?? []) as Row[]).map(w => String(w.deal_id));
  const { data: vs } = await sb.from("brokerage_funding_verifications").select("deal_id").eq("status", "verified");
  const vdi = new Set(((vs ?? []) as Row[]).map(v => String(v.deal_id)));
  let mv = 0; for (const d of fdi) { if (!vdi.has(d)) { mv++; ci.push(`Funded ${d} missing verification`); } }
  const { data: af } = await sb.from("brokerage_fee_ledger").select("deal_id, fee_type, amount_cents, status");
  const fr = (af ?? []) as Row[]; let fm = 0, tb = 0, tl = 0;
  for (const d of fdi) { const df = fr.filter(f => String(f.deal_id) === d); for (const f of df) { const s = str(f.status); if (s && !["funded", "waived", "cancelled"].includes(s)) { fm++; ci.push(`Deal ${d}: ${f.fee_type} "${s}"`); } if (s === "funded") { if (str(f.fee_type) === "borrower_packaging") tb += num(f.amount_cents) ?? 0; if (str(f.fee_type) === "lender_referral") tl += num(f.amount_cents) ?? 0; } } }
  const { data: evs } = await sb.from("brokerage_revenue_events").select("id");
  return { fundedDeals: fdi.length, missingVerification: mv, feeLedgerMismatches: fm, revenueEventCount: ((evs ?? []) as Row[]).length, totalBorrowerFees: tb, totalLenderFees: tl, criticalIssues: ci };
}

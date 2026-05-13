/**
 * BRK-10K Daily Ops — pure report builder.
 */
export type DailyStatus = "GREEN" | "YELLOW" | "RED";
export type ActionItem = { severity: "critical" | "followup"; category: string; message: string; dealId?: string; action: string };
export type RevenueSnapshot = { todayCents: number; mtdCents: number; ytdCents: number; fundedToday: number; fundedMtd: number; fundedYtd: number };
export type MarketplaceSnapshot = { activeListings: number; zeroClaimListings: number; nearCloseListings: number; atCapListings: number; pickedDeals: number; awaitingBorrowerPick: number };
export type ClosingSnapshot = { openWorkflows: number; conditionsOpen: number; conditionsOverdue: number; clearToClose: number; fundedTotal: number; missingVerification: number };
export type BorrowerSnapshot = { newSessionsToday: number; stuckIntake: number; missingStory: number; missingUploads: number; uploadsStuck: number; scoreMissing: number; scoreFailures: number; tridentFailures: number; readyToSeal: number; blockedByCompliance: number };
export type ComplianceSnapshot = { dealsWithoutEngagement: number; dealsWithoutFeeDisclosure: number; dealsWithoutForm159: number; dealsNeedingTwoMasters: number };
export type DailyOpsReport = { status: DailyStatus; date: string; criticalActions: ActionItem[]; followups: ActionItem[]; borrower: BorrowerSnapshot; marketplace: MarketplaceSnapshot; closing: ClosingSnapshot; revenue: RevenueSnapshot; compliance: ComplianceSnapshot; launchGateSummary: string | null; elapsed: number };
type Row = Record<string, any>;
export type DailyOpsInput = { now: Date; sessions: Row[]; deals: Row[]; concierges: Row[]; stories: Row[]; documents: Row[]; scores: Row[]; tridents: Row[]; sealedPackages: Row[]; listings: Row[]; claims: Row[]; picks: Row[]; accesses: Row[]; closingWorkflows: Row[]; closingConditions: Row[]; fundingVerifications: Row[]; feeLedger: Row[]; disclosures: Row[]; form159Records: Row[] };
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function sod(d: Date): string { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString(); }
function som(d: Date): string { return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); }
function soy(d: Date): string { return new Date(d.getFullYear(), 0, 1).toISOString(); }

export function buildDailyOpsReport(input: DailyOpsInput): DailyOpsReport {
  const start = Date.now(), today = sod(input.now), ms = som(input.now), ys = soy(input.now), nowMs = input.now.getTime();
  const ca: ActionItem[] = [], fu: ActionItem[] = [];
  const ha = (iso: string | null | undefined) => { if (!iso) return null; const t = new Date(iso).getTime(); return Number.isNaN(t) ? null : (nowMs - t) / 3_600_000; };
  const nst = input.sessions.filter(s => str(s.created_at) && str(s.created_at)! >= today).length;
  const storyIds = new Set(input.stories.map(s => String(s.deal_id)));
  const scoreIds = new Set(input.scores.map(s => String(s.deal_id)));
  const triIds = new Set(input.tridents.filter(t => str(t.status) === "succeeded").map(t => String(t.deal_id)));
  const sealIds = new Set(input.sealedPackages.map(s => String(s.deal_id)));
  let stuck = 0, mStory = 0, rts = 0;
  for (const d of input.deals) { const did = String(d.id), age = ha(str(d.updated_at)); if (!sealIds.has(did) && age != null && age > 24) stuck++; if (!storyIds.has(did)) mStory++; if (scoreIds.has(did) && triIds.has(did) && !sealIds.has(did)) rts++; }
  const pd = input.documents.filter(d => !d.finalized_at);
  const us = pd.filter(d => { const a = ha(str(d.created_at)); return a != null && a > 4; }).length;
  const sf = input.scores.filter(s => str(s.score_status) === "failed").length;
  const sm = input.deals.filter(d => !scoreIds.has(String(d.id))).length;
  const tf = input.tridents.filter(t => str(t.status) === "failed").length;
  const dab = new Map<string, Set<string>>();
  for (const disc of input.disclosures) { if (str(disc.status) !== "acknowledged") continue; const did = String(disc.deal_id); const s = dab.get(did) ?? new Set(); s.add(str(disc.disclosure_type) ?? ""); dab.set(did, s); }
  let bc = 0, dwe = 0, dwf = 0, dw159 = 0, d2m = 0;
  const f159 = new Set(input.form159Records.map(r => String(r.deal_id)));
  for (const did of sealIds) { const acks = dab.get(did) ?? new Set(); let b = false; if (!acks.has("borrower_engagement_letter")) { dwe++; b = true; } if (!acks.has("fee_disclosure")) { dwf++; b = true; } if (!f159.has(did)) { dw159++; b = true; } if (b) bc++; }
  const flbd = new Map<string, Set<string>>();
  for (const f of input.feeLedger) { if (["waived", "cancelled"].includes(str(f.status) ?? "")) continue; const did = String(f.deal_id); const s = flbd.get(did) ?? new Set(); s.add(str(f.fee_type) ?? ""); flbd.set(did, s); }
  for (const [did, types] of flbd) { if (types.has("borrower_packaging") && types.has("lender_referral") && !(dab.get(did) ?? new Set()).has("two_masters_consent")) d2m++; }
  const acbl = new Map<string, number>();
  for (const c of input.claims) { if (str(c.status) !== "active") continue; const lid = String(c.listing_id); acbl.set(lid, (acbl.get(lid) ?? 0) + 1); }
  const al = input.listings.filter(l => !["expired", "picked"].includes(str(l.status) ?? ""));
  const zcl = al.filter(l => (acbl.get(String(l.id)) ?? 0) === 0 && ["claiming", "awaiting_borrower_pick"].includes(str(l.status) ?? "")).length;
  const ncl = al.filter(l => { const c = str(l.claim_closes_at); if (!c) return false; const h = (new Date(c).getTime() - nowMs) / 3_600_000; return h >= 0 && h < 24; }).length;
  const cap = al.filter(l => (acbl.get(String(l.id)) ?? 0) >= 3).length;
  const pli = new Set(input.picks.filter(p => str(p.status) === "picked").map(p => String(p.listing_id)));
  const awp = input.listings.filter(l => str(l.status) === "awaiting_borrower_pick" && !pli.has(String(l.id))).length;
  const ow = input.closingWorkflows.filter(w => ["opened", "conditions_pending", "submitted_to_lender"].includes(str(w.status) ?? "")).length;
  const co = input.closingConditions.filter(c => str(c.status) === "open").length;
  const cod = input.closingConditions.filter(c => { if (str(c.status) !== "open" && str(c.status) !== "submitted") return false; const due = str(c.due_date); return due ? new Date(due).getTime() < nowMs : false; }).length;
  const ctc = input.closingWorkflows.filter(w => str(w.status) === "clear_to_close").length;
  const ft = input.closingWorkflows.filter(w => str(w.status) === "funded").length;
  const vdi = new Set(input.fundingVerifications.filter(v => str(v.status) === "verified").map(v => String(v.deal_id)));
  const fdi = new Set(input.closingWorkflows.filter(w => str(w.status) === "funded").map(w => String(w.deal_id)));
  let mv = 0; for (const did of fdi) { if (!vdi.has(did)) mv++; }
  const ff = input.feeLedger.filter(f => str(f.status) === "funded");
  const sc = (rows: Row[]) => rows.reduce((s, r) => s + (num(r.amount_cents) ?? 0), 0);
  if (sf > 0) ca.push({ severity: "critical", category: "intake", message: `${sf} score computation failure(s)`, action: "Review score logs and retry" });
  if (tf > 0) ca.push({ severity: "critical", category: "intake", message: `${tf} Trident generation failure(s)`, action: "Retry Trident generation" });
  if (mv > 0) ca.push({ severity: "critical", category: "revenue", message: `${mv} funded deal(s) missing revenue verification`, action: "Run verifyDealFunding for funded deals" });
  if (cod > 0) ca.push({ severity: "critical", category: "closing", message: `${cod} closing condition(s) overdue`, action: "Contact borrower/lender about overdue conditions" });
  if (rts > 0) fu.push({ severity: "followup", category: "intake", message: `${rts} deal(s) ready to seal`, action: "Review and seal packages" });
  if (stuck > 0) fu.push({ severity: "followup", category: "intake", message: `${stuck} deal(s) stuck in intake > 24h`, action: "Follow up with borrowers" });
  if (mStory > 0) fu.push({ severity: "followup", category: "intake", message: `${mStory} deal(s) missing discovery story`, action: "Ask borrowers to finish discovery interview" });
  if (zcl > 0) fu.push({ severity: "followup", category: "marketplace", message: `${zcl} listing(s) with zero claims`, action: "Contact matched lenders" });
  if (ncl > 0) fu.push({ severity: "followup", category: "marketplace", message: `${ncl} listing(s) closing within 24h`, action: "Monitor claim activity" });
  if (awp > 0) fu.push({ severity: "followup", category: "marketplace", message: `${awp} borrower(s) need to pick a lender`, action: "Notify borrowers to select lender" });
  if (us > 0) fu.push({ severity: "followup", category: "intake", message: `${us} upload(s) stuck > 4h`, action: "Review OCR/processing pipeline" });
  if (bc > 0) fu.push({ severity: "followup", category: "compliance", message: `${bc} sealed deal(s) blocked by compliance`, action: "Collect missing disclosures" });
  if (ctc > 0) fu.push({ severity: "followup", category: "closing", message: `${ctc} deal(s) clear to close`, action: "Coordinate closing with lender" });
  let status: DailyStatus = "GREEN"; if (fu.length > 0) status = "YELLOW"; if (ca.length > 0) status = "RED";
  const tdf = ff.filter(f => str(f.funding_verified_at) && str(f.funding_verified_at)! >= today);
  const mdf = ff.filter(f => str(f.funding_verified_at) && str(f.funding_verified_at)! >= ms);
  const ydf = ff.filter(f => str(f.funding_verified_at) && str(f.funding_verified_at)! >= ys);
  return { status, date: input.now.toISOString().slice(0, 10), criticalActions: ca, followups: fu,
    borrower: { newSessionsToday: nst, stuckIntake: stuck, missingStory: mStory, missingUploads: pd.length, uploadsStuck: us, scoreMissing: sm, scoreFailures: sf, tridentFailures: tf, readyToSeal: rts, blockedByCompliance: bc },
    marketplace: { activeListings: al.length, zeroClaimListings: zcl, nearCloseListings: ncl, atCapListings: cap, pickedDeals: input.picks.filter(p => str(p.status) === "picked").length, awaitingBorrowerPick: awp },
    closing: { openWorkflows: ow, conditionsOpen: co, conditionsOverdue: cod, clearToClose: ctc, fundedTotal: ft, missingVerification: mv },
    revenue: { todayCents: sc(tdf), mtdCents: sc(mdf), ytdCents: sc(ydf), fundedToday: input.fundingVerifications.filter(v => str(v.status) === "verified" && str(v.created_at) && str(v.created_at)! >= today).length, fundedMtd: input.fundingVerifications.filter(v => str(v.status) === "verified" && str(v.created_at) && str(v.created_at)! >= ms).length, fundedYtd: input.fundingVerifications.filter(v => str(v.status) === "verified" && str(v.created_at) && str(v.created_at)! >= ys).length },
    compliance: { dealsWithoutEngagement: dwe, dealsWithoutFeeDisclosure: dwf, dealsWithoutForm159: dw159, dealsNeedingTwoMasters: d2m },
    launchGateSummary: null, elapsed: Date.now() - start };
}

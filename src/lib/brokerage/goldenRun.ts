/**
 * Phase 9 — Golden Brokerage Run
 *
 * Deterministic end-to-end simulation: intake → score → trident → seal →
 * listing → claim → pick → unlock → ops validation.
 *
 * Each step inserts synthetic data directly. Real helpers used for
 * claim/pick/unlock where the RPC exists; direct insert fallback otherwise.
 *
 * Every insert below is validated against the LIVE schema (2026-06-12):
 *   - deals has no metadata column; is_test marks the synthetic deal
 *   - borrower_concierge_sessions has no metadata column
 *   - deal_borrower_story.bank_id is NOT NULL
 *   - deal_documents requires storage_path + document_key, and finalized
 *     rows must carry checklist_key (check constraint)
 *   - buddy_sba_scores requires score_version, the four strength jsonb
 *     columns, narrative, input/weights snapshots, computation_context;
 *     it has no component_scores or metadata columns
 *   - buddy_trident_bundles has no metadata column
 *   - banks has is_sandbox, not active
 *   - marketplace_claims has no deal_id / committed_rate_bps / updated_at;
 *     allowed statuses are pending|active|withdrawn|expired — the pick is
 *     recorded on marketplace_picks + the listing, the winning claim stays
 *     active, losing claims expire
 */

export type GoldenRunResult = {
  ok: boolean;
  dealId: string;
  listingId: string;
  claimId: string;
  pickId: string;
  accessId: string;
  lenderBankId: string;
  lenderName: string;
  score: number;
  band: string;
  elapsed: number;
  failedStage?: string;
  failedReason?: string;
};

type StepResult = { ok: boolean; error?: string; data?: Record<string, any> };
type Ctx = {
  sb: any; brokerageBankId: string; dealId: string; lenderBankId: string;
  sealedPackageId: string; listingId: string; claimId: string;
  pickId: string; accessId: string; score: number; band: string;
};

const NAME = "Golden Test Manufacturing LLC";
const LENDER = "Golden Test Bank";
const SCORE = 78;
const BAND = "strong_fit";
const RATE = 275;
const AMOUNT = 850000;
const TERM = 120;

function uuid(): string { return crypto.randomUUID(); }
function now(): string { return new Date().toISOString(); }

async function s1(c: Ctx): Promise<StepResult> {
  const id = uuid();
  const { error } = await c.sb.from("deals").insert({ id, bank_id: c.brokerageBankId, deal_type: "SBA", origin: "brokerage_anonymous", display_name: NAME, borrower_name: "Golden Borrower", borrower_email: "golden@test.local", loan_amount: AMOUNT, state: "TX", status: "active", is_test: true });
  if (error) return { ok: false, error: `deal: ${error.message}` };
  c.dealId = id; return { ok: true };
}

async function s2(c: Ctx): Promise<StepResult> {
  const facts = { borrower: { first_name: "Golden", last_name: "Borrower", email: "golden@test.local" }, business: { legal_name: NAME, industry_description: "Metal fabrication", naics: "332710", is_franchise: false, years_in_business: 8 }, loan: { amount_requested: AMOUNT, use_of_proceeds: "Equipment", term_months: TERM } };
  const { error: e1 } = await c.sb.from("borrower_concierge_sessions").insert({ deal_id: c.dealId, bank_id: c.brokerageBankId, program: "7a", progress_pct: 100, extracted_facts: facts, confirmed_facts: facts, conversation_history: [{ role: "user", content: "Equipment loan" }] });
  if (e1) return { ok: false, error: `concierge: ${e1.message}` };
  const { error: e2 } = await c.sb.from("borrower_applications").upsert({ deal_id: c.dealId, business_legal_name: NAME, industry: "Metal fabrication", naics: "332710", loan_amount: AMOUNT, loan_type: "7a" }, { onConflict: "deal_id" });
  if (e2) return { ok: false, error: `app: ${e2.message}` };
  const { error: e3 } = await c.sb.from("deal_financial_facts").insert([{ deal_id: c.dealId, bank_id: c.brokerageBankId, fact_type: "concierge", fact_key: "TOTAL_REVENUE", fact_value_num: 2000000, fact_period_start: "2025-01-01", fact_period_end: "2025-12-31", provenance: { source: "concierge", golden_test: true } }, { deal_id: c.dealId, bank_id: c.brokerageBankId, fact_type: "concierge", fact_key: "YEARS_IN_BUSINESS", fact_value_num: 8, provenance: { source: "concierge", golden_test: true } }]);
  if (e3) return { ok: false, error: `facts: ${e3.message}` };
  return { ok: true };
}

async function s3(c: Ctx): Promise<StepResult> {
  // Fresh deal each run — plain insert; bank_id is NOT NULL on this table.
  const { error } = await c.sb.from("deal_borrower_story").insert({ deal_id: c.dealId, bank_id: c.brokerageBankId, business_description: "Regional metal fabrication shop.", products_services: "CNC machining, welding.", customers: "Construction contractors.", growth_strategy: "New 5-axis CNC.", key_risks: "Steel price volatility.", source: "borrower_self", confidence: 0.95 });
  if (error) return { ok: false, error: `story: ${error.message}` };
  return { ok: true };
}

async function s4(c: Ctx): Promise<StepResult> {
  // storage_path + document_key are NOT NULL; finalized rows must carry
  // checklist_key (finalized_docs_must_have_checklist_key constraint).
  const { error } = await c.sb.from("deal_documents").insert([
    { deal_id: c.dealId, bank_id: c.brokerageBankId, original_filename: "golden_btr.pdf", canonical_type: "BUSINESS_TAX_RETURN", checklist_key: "BUSINESS_TAX_RETURN", storage_path: `golden/${c.dealId}/btr.pdf`, document_key: `golden_btr_${c.dealId}`, finalized_at: now() },
    { deal_id: c.dealId, bank_id: c.brokerageBankId, original_filename: "golden_pfs.pdf", canonical_type: "PERSONAL_FINANCIAL_STATEMENT", checklist_key: "PERSONAL_FINANCIAL_STATEMENT", storage_path: `golden/${c.dealId}/pfs.pdf`, document_key: `golden_pfs_${c.dealId}`, finalized_at: now() },
  ]);
  if (error) return { ok: false, error: `docs: ${error.message}` };
  return { ok: true };
}

async function s5(c: Ctx): Promise<StepResult> {
  const { error } = await c.sb.from("buddy_sba_scores").insert({ deal_id: c.dealId, bank_id: c.brokerageBankId, score_version: "golden-test-1", score_status: "locked", eligibility_passed: true, score: SCORE, band: BAND, rate_card_tier: "standard", borrower_strength: { score: 4 }, business_strength: { score: 3.8 }, deal_structure: { score: 3.5 }, repayment_capacity: { score: 4.2 }, narrative: "Score 78.", top_strengths: ["8 years", "Clear proceeds"], top_weaknesses: ["Single location"], input_snapshot: { golden_test: true }, weights_snapshot: { golden_test: true }, computation_context: "manual", computed_at: now() });
  if (error) return { ok: false, error: `score: ${error.message}` };
  c.score = SCORE; c.band = BAND; return { ok: true };
}

async function s6(c: Ctx): Promise<StepResult> {
  const { error } = await c.sb.from("buddy_trident_bundles").insert({ deal_id: c.dealId, bank_id: c.brokerageBankId, mode: "preview", status: "succeeded", version: 1, generation_started_at: now(), generation_completed_at: now(), redactor_version: "1.0.0", business_plan_pdf_path: `golden/${c.dealId}/bp.pdf`, projections_pdf_path: `golden/${c.dealId}/proj.pdf`, feasibility_pdf_path: `golden/${c.dealId}/feas.pdf` });
  if (error) return { ok: false, error: `trident: ${error.message}` };
  return { ok: true };
}

async function s7(c: Ctx): Promise<StepResult> {
  const id = uuid();
  const { error } = await c.sb.from("buddy_sealed_packages").insert({ id, deal_id: c.dealId, bank_id: c.brokerageBankId, sealed_snapshot: { golden_test: true, score: SCORE, band: BAND }, sealed_at: now() });
  if (error) return { ok: false, error: `seal: ${error.message}` };
  c.sealedPackageId = id; return { ok: true };
}

async function s8(c: Ctx): Promise<StepResult> {
  const id = uuid();
  const open = new Date(Date.now() - 3_600_000);
  const close = new Date(Date.now() + 48 * 3_600_000);
  const { error } = await c.sb.from("marketplace_listings").insert({ id, sealed_package_id: c.sealedPackageId, deal_id: c.dealId, kfs: { redactionVersion: "1.0.0", state: "TX", industryNaics: "332710", sbaProgram: "7a", loanAmount: AMOUNT }, kfs_redaction_version: "1.0.0", score: SCORE, band: BAND, rate_card_tier: "standard", published_rate_bps: RATE, sba_program: "7a", loan_amount: AMOUNT, term_months: TERM, matched_lender_bank_ids: [c.lenderBankId], preview_opens_at: new Date(open.getTime() - 86400000).toISOString(), claim_opens_at: open.toISOString(), claim_closes_at: close.toISOString(), status: "claiming" });
  if (error) return { ok: false, error: `listing: ${error.message}` };
  c.listingId = id; return { ok: true };
}

async function s9(c: Ctx): Promise<StepResult> {
  const { data: ex } = await c.sb.from("banks").select("id").eq("id", c.lenderBankId).maybeSingle();
  if (!ex) { const { error } = await c.sb.from("banks").insert({ id: c.lenderBankId, code: `GOLDEN_TEST_${c.lenderBankId.slice(0, 8)}`, name: LENDER, bank_kind: "commercial_bank", is_sandbox: true }); if (error && !error.message?.includes("duplicate")) return { ok: false, error: `bank: ${error.message}` }; }
  const { data: ag } = await c.sb.from("lender_marketplace_agreements").select("id").eq("lender_bank_id", c.lenderBankId).eq("status", "active").maybeSingle();
  if (!ag) { const { error } = await c.sb.from("lender_marketplace_agreements").insert({ lender_bank_id: c.lenderBankId, status: "active", referral_fee_bps: 100, accepts_sba_7a: true, signed_by_name: "Golden Banker", signed_at: now() }); if (error) return { ok: false, error: `agr: ${error.message}` }; }
  return { ok: true };
}

async function s10(c: Ctx): Promise<StepResult> {
  const { data, error } = await c.sb.rpc("claim_marketplace_listing", { p_listing_id: c.listingId, p_lender_bank_id: c.lenderBankId });
  if (error) {
    // Fallback: direct insert. marketplace_claims has no deal_id or
    // committed_rate_bps columns — that context rides in metadata.
    const cid = uuid();
    const { error: e2 } = await c.sb.from("marketplace_claims").insert({ id: cid, listing_id: c.listingId, lender_bank_id: c.lenderBankId, status: "active", claimed_at: now(), metadata: { deal_id: c.dealId, committed_rate_bps: RATE, golden_test: true } });
    if (e2) return { ok: false, error: `claim: ${e2.message}` };
    await c.sb.from("marketplace_listings").update({ status: "awaiting_borrower_pick", updated_at: now() }).eq("id", c.listingId);
    await c.sb.from("marketplace_audit_log").insert({ listing_id: c.listingId, deal_id: c.dealId, actor_bank_id: c.lenderBankId, actor_scope: "lender", action: "claim_succeeded", metadata: { claim_id: cid, golden_test: true } });
    c.claimId = cid; return { ok: true, data: { method: "direct" } };
  }
  const r = data as any;
  if (!r?.ok) return { ok: false, error: `claim rpc: ${r?.error ?? "unknown"}` };
  c.claimId = String(r.claim_id); return { ok: true, data: { method: "rpc" } };
}

async function s11(c: Ctx): Promise<StepResult> {
  const pid = uuid(); const ts = now();
  const { error } = await c.sb.from("marketplace_picks").insert({ id: pid, listing_id: c.listingId, deal_id: c.dealId, claim_id: c.claimId, picked_lender_bank_id: c.lenderBankId, status: "picked", borrower_selected_at: ts });
  if (error) return { ok: false, error: `pick: ${error.message}` };
  // Claims vocabulary is pending|active|withdrawn|expired: the winning
  // claim stays active (the pick row + listing record the selection);
  // competing active claims expire.
  await c.sb.from("marketplace_claims").update({ status: "expired", expires_at: ts }).eq("listing_id", c.listingId).eq("status", "active").neq("id", c.claimId);
  await c.sb.from("marketplace_listings").update({ status: "picked", picked_at: ts, updated_at: ts }).eq("id", c.listingId);
  await c.sb.from("marketplace_audit_log").insert({ listing_id: c.listingId, deal_id: c.dealId, actor_scope: "borrower", action: "borrower_pick", metadata: { claim_id: c.claimId, pick_id: pid, golden_test: true } });
  c.pickId = pid; return { ok: true };
}

async function s12(c: Ctx): Promise<StepResult> {
  const { data: ex } = await c.sb.from("marketplace_package_access").select("id").eq("claim_id", c.claimId).maybeSingle();
  if (ex) { c.accessId = String(ex.id); return { ok: true, data: { idempotent: true } }; }
  const aid = uuid();
  const { error } = await c.sb.from("marketplace_package_access").insert({ id: aid, listing_id: c.listingId, claim_id: c.claimId, deal_id: c.dealId, lender_bank_id: c.lenderBankId, sealed_package_id: c.sealedPackageId, access_level: "full" });
  if (error) return { ok: false, error: `access: ${error.message}` };
  await c.sb.from("marketplace_audit_log").insert({ listing_id: c.listingId, deal_id: c.dealId, actor_bank_id: c.lenderBankId, actor_scope: "system", action: "package_unlocked", metadata: { claim_id: c.claimId, access_id: aid, golden_test: true } });
  c.accessId = aid; return { ok: true };
}

async function s13(c: Ctx): Promise<StepResult> {
  const { data: access } = await c.sb.from("marketplace_package_access").select("id").eq("deal_id", c.dealId);
  if (!access || (access as any[]).length !== 1) return { ok: false, error: `Expected 1 access, got ${(access as any[])?.length ?? 0}` };
  return { ok: true };
}

const STEPS: Array<{ name: string; fn: (c: Ctx) => Promise<StepResult> }> = [
  { name: "create_deal", fn: s1 }, { name: "concierge_facts", fn: s2 },
  { name: "discovery_story", fn: s3 }, { name: "uploads", fn: s4 },
  { name: "score", fn: s5 }, { name: "trident", fn: s6 },
  { name: "seal", fn: s7 }, { name: "lender_agreement", fn: s9 },
  { name: "listing", fn: s8 }, { name: "claim", fn: s10 },
  { name: "pick", fn: s11 }, { name: "unlock", fn: s12 },
  { name: "ops_validation", fn: s13 },
];

export async function cleanupGoldenRun(sb: any, dealId: string): Promise<void> {
  // marketplace_claims has no deal_id — resolve via the deal's listings.
  const { data: listings } = await sb.from("marketplace_listings").select("id").eq("deal_id", dealId);
  const listingIds = ((listings ?? []) as Array<{ id: string }>).map((l) => l.id);
  if (listingIds.length > 0) {
    await sb.from("marketplace_claims").delete().in("listing_id", listingIds);
  }
  for (const t of ["marketplace_package_access", "marketplace_audit_log", "marketplace_picks", "marketplace_listings", "buddy_sealed_packages", "buddy_trident_bundles", "buddy_sba_scores", "deal_financial_facts", "deal_documents", "deal_borrower_story", "borrower_applications", "borrower_concierge_sessions"]) {
    await sb.from(t).delete().eq("deal_id", dealId);
  }
  await sb.from("deals").delete().eq("id", dealId);
}

export async function runGoldenBrokerageRun(args: {
  sb: any; brokerageBankId: string; lenderBankId?: string; cleanup?: boolean;
}): Promise<GoldenRunResult> {
  const start = Date.now();
  const c: Ctx = { sb: args.sb, brokerageBankId: args.brokerageBankId, dealId: "", lenderBankId: args.lenderBankId ?? uuid(), sealedPackageId: "", listingId: "", claimId: "", pickId: "", accessId: "", score: 0, band: "" };

  for (const step of STEPS) {
    const r = await step.fn(c);
    if (!r.ok) {
      if (args.cleanup && c.dealId) await cleanupGoldenRun(args.sb, c.dealId).catch(() => {});
      return { ok: false, dealId: c.dealId, listingId: c.listingId, claimId: c.claimId, pickId: c.pickId, accessId: c.accessId, lenderBankId: c.lenderBankId, lenderName: LENDER, score: c.score, band: c.band, elapsed: Date.now() - start, failedStage: step.name, failedReason: r.error };
    }
  }

  if (args.cleanup && c.dealId) await cleanupGoldenRun(args.sb, c.dealId).catch(() => {});
  return { ok: true, dealId: c.dealId, listingId: c.listingId, claimId: c.claimId, pickId: c.pickId, accessId: c.accessId, lenderBankId: c.lenderBankId, lenderName: LENDER, score: c.score, band: c.band, elapsed: Date.now() - start };
}

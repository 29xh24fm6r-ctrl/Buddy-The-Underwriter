import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSbaEligibilityInput } from "@/lib/sba/dealDataBuilder";

type Row = Record<string, any>;

class FakeQuery {
  private table: string;
  private db: Record<string, Row[]>;
  private filters: Array<{ k: string; v: any }> = [];
  private limitN: number | null = null;

  constructor(db: Record<string, Row[]>, table: string) {
    this.db = db;
    this.table = table;
  }
  select(_cols?: string) {
    return this;
  }
  eq(k: string, v: any) {
    this.filters.push({ k, v });
    return this;
  }
  order(_k: string, _opts?: any) {
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  private rows(): Row[] {
    let rows = [...(this.db[this.table] ?? [])];
    for (const f of this.filters) rows = rows.filter((r) => r[f.k] === f.v);
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    return rows;
  }
  maybeSingle(): Promise<{ data: Row | null }> {
    return Promise.resolve({ data: this.rows()[0] ?? null });
  }
  then(resolve: any, reject?: any) {
    return Promise.resolve({ data: this.rows() }).then(resolve, reject);
  }
}

class FakeDb {
  tables: Record<string, Row[]>;
  constructor(seed?: Partial<Record<string, Row[]>>) {
    this.tables = {
      deals: [],
      deal_loan_requests: [],
      ownership_entities: [],
      financial_snapshots: [],
      deal_franchises: [],
      franchise_brands: [],
      borrower_caivrs_checks: [],
      signed_documents: [],
      borrower_irs_transcript_requests: [],
      ...seed,
    };
  }
  from(table: string) {
    return new FakeQuery(this.tables, table);
  }
}

const BASE_LOAN_REQUEST = {
  deal_id: "d1",
  created_at: "2026-01-01",
  requested_amount: null,
  use_of_proceeds: [],
};

test("loan 200K + sba_7a -> is_7a_small_loan = true", async () => {
  const db = new FakeDb({
    deals: [{ id: "d1", deal_type: "sba_7a", loan_amount: null }],
    deal_loan_requests: [{ ...BASE_LOAN_REQUEST, requested_amount: 200_000 }],
  });
  const r = await buildSbaEligibilityInput("d1", db as any);
  assert.equal(r.is_7a_small_loan, true);
});

test("loan 400K + sba_7a -> is_7a_small_loan = false", async () => {
  const db = new FakeDb({
    deals: [{ id: "d1", deal_type: "sba_7a", loan_amount: null }],
    deal_loan_requests: [{ ...BASE_LOAN_REQUEST, requested_amount: 400_000 }],
  });
  const r = await buildSbaEligibilityInput("d1", db as any);
  assert.equal(r.is_7a_small_loan, false);
});

test("all owners us_citizen + LPR -> all_owners_citizenship_eligible = true", async () => {
  const db = new FakeDb({
    deals: [{ id: "d1", deal_type: "sba_7a" }],
    ownership_entities: [
      { deal_id: "d1", entity_type: "individual", citizenship_status: "us_citizen", ownership_pct: 60 },
      { deal_id: "d1", entity_type: "individual", citizenship_status: "lawful_permanent_resident", ownership_pct: 40 },
    ],
  });
  const r = await buildSbaEligibilityInput("d1", db as any);
  assert.equal(r.all_owners_citizenship_eligible, true);
});

test("one owner visa_holder -> all_owners_citizenship_eligible = false", async () => {
  const db = new FakeDb({
    deals: [{ id: "d1", deal_type: "sba_7a" }],
    ownership_entities: [
      { deal_id: "d1", entity_type: "individual", citizenship_status: "us_citizen", ownership_pct: 60 },
      { deal_id: "d1", entity_type: "individual", citizenship_status: "visa_holder", ownership_pct: 40 },
    ],
  });
  const r = await buildSbaEligibilityInput("d1", db as any);
  assert.equal(r.all_owners_citizenship_eligible, false);
});

test("owner with unset citizenship -> all_owners_citizenship_eligible = null", async () => {
  const db = new FakeDb({
    deals: [{ id: "d1", deal_type: "sba_7a" }],
    ownership_entities: [
      { deal_id: "d1", entity_type: "individual", citizenship_status: "us_citizen", ownership_pct: 60 },
      { deal_id: "d1", entity_type: "individual", citizenship_status: null, ownership_pct: 40 },
    ],
  });
  const r = await buildSbaEligibilityInput("d1", db as any);
  assert.equal(r.all_owners_citizenship_eligible, null);
});

test("no franchise -> is_franchise_deal = false, other franchise fields null", async () => {
  const db = new FakeDb({ deals: [{ id: "d1", deal_type: "sba_7a" }] });
  const r = await buildSbaEligibilityInput("d1", db as any);
  assert.equal(r.is_franchise_deal, false);
  assert.equal(r.franchise_brand_on_directory, null);
  assert.equal(r.franchise_brand_certified_or_pre_deadline, null);
});

test("franchise with sba_certification_status=certified -> certified_or_pre_deadline = true", async () => {
  const db = new FakeDb({
    deals: [{ id: "d1", deal_type: "sba_7a" }],
    deal_franchises: [{ deal_id: "d1", brand_id: "b1" }],
    franchise_brands: [{ id: "b1", sba_directory_id: "SBA-123", sba_certification_status: "certified" }],
  });
  const r = await buildSbaEligibilityInput("d1", db as any);
  assert.equal(r.is_franchise_deal, true);
  assert.equal(r.franchise_brand_on_directory, true);
  assert.equal(r.franchise_brand_certified_or_pre_deadline, true);
});

test("franchise with status=null (grace deadline has passed) -> certified_or_pre_deadline = false", async () => {
  // As of this test's authoring date (2026-07-12), the SOP 50 10 8
  // certification grace deadline (2026-06-30) has already passed, so an
  // uncertified brand must now read false, not true.
  const db = new FakeDb({
    deals: [{ id: "d1", deal_type: "sba_7a" }],
    deal_franchises: [{ deal_id: "d1", brand_id: "b1" }],
    franchise_brands: [{ id: "b1", sba_directory_id: "SBA-123", sba_certification_status: null }],
  });
  const r = await buildSbaEligibilityInput("d1", db as any);
  assert.equal(r.franchise_brand_certified_or_pre_deadline, false);
});

test("WC 600K of 1M proceeds -> working_capital_pct_of_proceeds = 0.6", async () => {
  const db = new FakeDb({
    deals: [{ id: "d1", deal_type: "sba_7a" }],
    deal_loan_requests: [
      {
        ...BASE_LOAN_REQUEST,
        use_of_proceeds: [
          { category: "working_capital", amount: 600_000 },
          { category: "equipment", amount: 400_000 },
        ],
      },
    ],
  });
  const r = await buildSbaEligibilityInput("d1", db as any);
  assert.equal(r.working_capital_pct_of_proceeds, 0.6);
});

test("seller note 50K of 100K equity -> seller_note_pct_of_equity = 0.5", async () => {
  const db = new FakeDb({
    deals: [{ id: "d1", deal_type: "sba_7a" }],
    deal_loan_requests: [
      { ...BASE_LOAN_REQUEST, seller_note_equity_portion: 50_000, equity_injection_amount: 100_000 },
    ],
  });
  const r = await buildSbaEligibilityInput("d1", db as any);
  assert.equal(r.seller_note_pct_of_equity, 0.5);
});

test("use of proceeds includes mca_refi -> use_of_proceeds_includes_mca_refi = true", async () => {
  const db = new FakeDb({
    deals: [{ id: "d1", deal_type: "sba_7a" }],
    deal_loan_requests: [
      { ...BASE_LOAN_REQUEST, use_of_proceeds: [{ category: "mca_refi", description: "Payoff MCA", amount: 50_000 }] },
    ],
  });
  const r = await buildSbaEligibilityInput("d1", db as any);
  assert.equal(r.use_of_proceeds_includes_mca_refi, true);
});

test("single owner -> is_single_owner_business = true", async () => {
  const db = new FakeDb({
    deals: [{ id: "d1", deal_type: "sba_7a" }],
    ownership_entities: [{ deal_id: "d1", entity_type: "individual", citizenship_status: "us_citizen", ownership_pct: 100 }],
  });
  const r = await buildSbaEligibilityInput("d1", db as any);
  assert.equal(r.is_single_owner_business, true);
});

test("fields not yet computable return null, not fabricated defaults", async () => {
  const db = new FakeDb({ deals: [{ id: "d1", deal_type: "sba_7a" }] });
  const r = await buildSbaEligibilityInput("d1", db as any);
  // caivrs_checked/form_4506c_signed are booleans ("has this run yet?"),
  // so their unset state is false, not null — matches is_franchise_deal's
  // existing null-vs-false convention. caivrs_hits/borrower_has_prior_sba_loss
  // stay null: there's no data yet to compute a number/verdict from.
  assert.equal(r.caivrs_checked, false);
  assert.equal(r.caivrs_hits, null);
  assert.equal(r.borrower_has_prior_sba_loss, null);
  assert.equal(r.form_4506c_signed, false);
  assert.equal(r.tax_transcripts_received_or_pending, null);
  assert.equal(r.lender_is_federally_regulated, null);
  assert.equal(r.screening_uses_sbss, false);
});

test("S4: CAIVRS checked with no hits -> caivrs_checked=true, caivrs_hits=0, borrower_has_prior_sba_loss=false", async () => {
  const db = new FakeDb({
    deals: [{ id: "d1", deal_type: "sba_7a" }],
    borrower_caivrs_checks: [{ deal_id: "d1", hit_count: 0, hit_details: [] }],
  });
  const r = await buildSbaEligibilityInput("d1", db as any);
  assert.equal(r.caivrs_checked, true);
  assert.equal(r.caivrs_hits, 0);
  assert.equal(r.borrower_has_prior_sba_loss, false);
});

test("S4: CAIVRS hit with SBA program in hit_details -> caivrs_hits summed, borrower_has_prior_sba_loss=true", async () => {
  const db = new FakeDb({
    deals: [{ id: "d1", deal_type: "sba_7a" }],
    borrower_caivrs_checks: [
      { deal_id: "d1", hit_count: 2, hit_details: [{ program: "SBA 7(a)" }, { program: "FHA" }] },
      { deal_id: "d1", hit_count: 0, hit_details: [] },
    ],
  });
  const r = await buildSbaEligibilityInput("d1", db as any);
  assert.equal(r.caivrs_checked, true);
  assert.equal(r.caivrs_hits, 2);
  assert.equal(r.borrower_has_prior_sba_loss, true);
});

test("S4: signed FORM_4506C exists -> form_4506c_signed=true", async () => {
  const db = new FakeDb({
    deals: [{ id: "d1", deal_type: "sba_7a" }],
    signed_documents: [{ deal_id: "d1", form_code: "FORM_4506C" }],
  });
  const r = await buildSbaEligibilityInput("d1", db as any);
  assert.equal(r.form_4506c_signed, true);
});

test("S4: IRS transcript request submitted -> tax_transcripts_received_or_pending=true", async () => {
  const db = new FakeDb({
    deals: [{ id: "d1", deal_type: "sba_7a" }],
    borrower_irs_transcript_requests: [{ deal_id: "d1", status: "submitted" }],
  });
  const r = await buildSbaEligibilityInput("d1", db as any);
  assert.equal(r.tax_transcripts_received_or_pending, true);
});

test("S4: IRS transcript request expired (no submitted/received/reconciled/pending_signature) -> false", async () => {
  const db = new FakeDb({
    deals: [{ id: "d1", deal_type: "sba_7a" }],
    borrower_irs_transcript_requests: [{ deal_id: "d1", status: "expired" }],
  });
  const r = await buildSbaEligibilityInput("d1", db as any);
  assert.equal(r.tax_transcripts_received_or_pending, false);
});

test("Phase 4 (504): creates_or_retains_jobs/meets_public_policy_goal/owner_occupancy_percentage wired from deal_loan_requests", async () => {
  const db = new FakeDb({
    deals: [{ id: "d1", deal_type: "sba_504" }],
    deal_loan_requests: [
      { ...BASE_LOAN_REQUEST, creates_or_retains_jobs: true, meets_public_policy_goal: false, occupancy_percentage: 60 },
    ],
  });
  const r = await buildSbaEligibilityInput("d1", db as any);
  assert.equal(r.creates_or_retains_jobs, true);
  assert.equal(r.meets_public_policy_goal, false);
  assert.equal(r.owner_occupancy_percentage, 60);
});

test("Phase 4 (504): no loan request -> 504 fields stay null, not fabricated", async () => {
  const db = new FakeDb({ deals: [{ id: "d1", deal_type: "sba_504" }] });
  const r = await buildSbaEligibilityInput("d1", db as any);
  assert.equal(r.creates_or_retains_jobs, null);
  assert.equal(r.meets_public_policy_goal, null);
  assert.equal(r.owner_occupancy_percentage, null);
});

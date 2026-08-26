import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { evaluateTridentRelease } =
  require("../trident/tridentReleaseGate") as typeof import("../trident/tridentReleaseGate");
const { canSeal } = require("../sealingGate") as typeof import("../sealingGate");
const { buildSealedSnapshot, sealedPackageArtifactColumns } =
  require("../buildSealedSnapshot") as typeof import("../buildSealedSnapshot");
const { buildPackageManifest } =
  require("../packageDelivery") as typeof import("../packageDelivery");

/**
 * Producer-to-consumer contract for the Golden Trident final bundle.
 *
 * The regression this exists to prevent (audit F-01/F-02): `sealingGate` and
 * `buildSealedSnapshot` required `projections_pdf_path` on a final bundle,
 * but `generateTridentBundle` only ever writes that column in preview mode
 * (`mode === "preview"` guards the render). Every real deal was therefore
 * unsealable, and the guard tests could not see it because they matched
 * source text rather than running the modules against a row the generator
 * can actually produce.
 *
 * These tests take ONE row shaped exactly as final mode publishes it and walk
 * it through every consumer in the distribution chain. Any future divergence
 * between what the factory writes and what a downstream gate demands fails
 * here, in the module that actually enforces it.
 */

const DEAL_ID = "deal-contract-1";

/**
 * A final-mode bundle exactly as `generateTridentBundle` publishes one.
 *
 * `projections_pdf_path` is null and MUST stay null: the redacted summary PDF
 * is preview-only by design (see the redactor contract), and final mode ships
 * the unwatermarked XLSX workbook instead. This is the same three-artifact set
 * asserted by `finalize_trident_bundle_run` and by the table constraint
 * `buddy_trident_final_success_certified_check`.
 */
function finalBundleAsProduced(overrides: Record<string, unknown> = {}) {
  return {
    id: "bundle-1",
    deal_id: DEAL_ID,
    bank_id: "bank-1",
    mode: "final",
    status: "succeeded",
    superseded_at: null,
    generated_at: "2026-08-20T00:00:00.000Z",
    release_gate_json: { ok: true, reasons: [], warnings: [] },
    input_hash: "a".repeat(64),
    memo_input_hash: "memo-hash",
    canonical_memo_input_hash: "memo-hash",
    source_credit_memo_id: "memo-1",
    source_spread_id: "spread-1",
    business_plan_pdf_path: `${DEAL_ID}/final/1_business_plan.pdf`,
    projections_pdf_path: null,
    projections_xlsx_path: `${DEAL_ID}/final/1_projections.xlsx`,
    feasibility_pdf_path: `${DEAL_ID}/final/1_feasibility.pdf`,
    ...overrides,
  };
}

/** Release-gate evidence for the same run. */
function releaseEvidence(overrides: Record<string, unknown> = {}) {
  const bundle = finalBundleAsProduced();
  return {
    businessPlanVerdict: "pass",
    feasibilityVerdict: "pass",
    feasibilityCompleteness: 0.86,
    feasibilityCitationCount: 4,
    projectionsNarrative: Array.from({ length: 60 }, (_, i) => `word${i}`).join(" "),
    sourcesAndUses: { balanced: true, imbalance: 0 },
    memoId: "memo-1",
    memoInputHash: "memo-hash",
    expectedMemoInputHash: "memo-hash",
    memoResearchTrustGrade: "committee_grade",
    spreadId: "spread-1",
    spreadReady: true,
    spreadHasIntegrityHash: true,
    spreadHasCanonicalFactsTimestamp: true,
    spreadAccuracyStatus: "clean",
    spreadAccuracyBlockerCount: 0,
    isTestDeal: false,
    // Exactly what the factory hands the gate — three artifacts, no PDF.
    artifactPaths: [
      bundle.business_plan_pdf_path,
      bundle.projections_xlsx_path,
      bundle.feasibility_pdf_path,
    ],
    ...overrides,
  };
}

// ── Minimal Supabase stub ───────────────────────────────────────────────────
type Row = Record<string, any>;

class Db {
  tables: Record<string, Row[]>;
  constructor(seed: Partial<Record<string, Row[]>> = {}) {
    this.tables = {
      deals: [],
      buddy_sba_scores: [],
      buddy_sba_assumptions: [],
      buddy_trident_bundles: [],
      buddy_validation_reports: [],
      buddy_sealed_packages: [],
      ownership_entities: [],
      borrower_identity_verifications: [],
      borrower_applications: [],
      borrower_applicant_financials: [],
      deal_financial_facts: [],
      buddy_sba_packages: [],
      buddy_feasibility_studies: [],
      borrower_concierge_sessions: [],
      sba_form_159_records: [],
      credit_memo_snapshots: [],
      sba_package_runs: [],
      marketplace_picks: [],
      banks: [],
      ...seed,
    };
  }
  from(table: string) {
    return new Query(this, table);
  }
}

class Query {
  private db: Db;
  private table: string;
  private filters: Array<{ t: string; k: string; v: any }> = [];
  private lim: number | null = null;
  constructor(db: Db, table: string) {
    this.db = db;
    this.table = table;
  }
  select() {
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  eq(k: string, v: any) {
    this.filters.push({ t: "eq", k, v });
    return this;
  }
  in(k: string, v: any[]) {
    this.filters.push({ t: "in", k, v });
    return this;
  }
  is(k: string, v: any) {
    this.filters.push({ t: "is", k, v });
    return this;
  }
  not(_k: string, _op: string, _v: any) {
    return this;
  }
  private rows(): Row[] {
    let rows = [...(this.db.tables[this.table] ?? [])];
    for (const f of this.filters) {
      if (f.t === "eq") rows = rows.filter((r) => r[f.k] === f.v);
      else if (f.t === "in") rows = rows.filter((r) => (f.v as any[]).includes(r[f.k]));
      else if (f.t === "is")
        rows = rows.filter((r) => (f.v === null ? r[f.k] == null : r[f.k] === f.v));
    }
    return this.lim != null ? rows.slice(0, this.lim) : rows;
  }
  maybeSingle() {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  single() {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  then(resolve: (r: { data: any; error: null }) => void) {
    resolve({ data: this.rows(), error: null });
  }
}

/** A deal in the exact state that should be sealable. */
function sealableDb(bundleOverrides: Record<string, unknown> = {}) {
  return new Db({
    deals: [
      { id: DEAL_ID, bank_id: "bank-1", state: "TX", loan_amount: 850_000, is_test: false },
    ],
    buddy_sba_scores: [
      {
        deal_id: DEAL_ID,
        score: 78,
        band: "strong_fit",
        eligibility_passed: true,
        score_status: "locked",
        rate_card_tier: "standard",
      },
    ],
    buddy_sba_assumptions: [
      {
        deal_id: DEAL_ID,
        status: "confirmed",
        loan_impact: { termMonths: 120, loanAmount: 850_000 },
      },
    ],
    buddy_trident_bundles: [finalBundleAsProduced(bundleOverrides)],
    buddy_validation_reports: [{ deal_id: DEAL_ID, overall_status: "PASS" }],
    borrower_applications: [{ deal_id: DEAL_ID, naics: "332710", industry: "Metal fabrication" }],
    buddy_sba_packages: [{ deal_id: DEAL_ID, use_of_proceeds: [], sources_and_uses: {} }],
    buddy_feasibility_studies: [{ deal_id: DEAL_ID, is_franchise: false, composite_score: 74 }],
  });
}

// ── The contract ────────────────────────────────────────────────────────────

test("a bundle the release gate certifies carries exactly three artifacts", () => {
  const gate = evaluateTridentRelease(releaseEvidence() as any);
  assert.deepEqual(gate.reasons, []);
  assert.equal(gate.ok, true);
});

test("the release gate blocks when any of those three artifacts is missing", () => {
  for (const index of [0, 1, 2]) {
    const paths: Array<string | null> = releaseEvidence().artifactPaths.slice();
    paths[index] = null;
    const gate = evaluateTridentRelease(releaseEvidence({ artifactPaths: paths }) as any);
    assert.equal(gate.ok, false, `artifact ${index} should be required`);
    assert.ok(gate.reasons.includes("required_rendered_artifact_missing"));
  }
});

test("a certified final bundle is sealable — no consumer may demand a fourth artifact", async () => {
  const db = sealableDb();
  const result = await canSeal(DEAL_ID, db as any);
  assert.deepEqual(
    result.ok ? [] : result.reasons,
    [],
    "canSeal must accept the exact row final mode publishes",
  );
  assert.equal(result.ok, true);
});

test("canSeal still fails closed on each artifact final mode does produce", async () => {
  for (const column of [
    "business_plan_pdf_path",
    "projections_xlsx_path",
    "feasibility_pdf_path",
  ]) {
    const db = sealableDb({ [column]: null });
    const result = await canSeal(DEAL_ID, db as any);
    assert.equal(result.ok, false, `${column} must remain required`);
    assert.ok(
      !result.ok &&
        result.reasons.some((r) => r.includes("artifact set is incomplete")),
      `${column} must produce the incomplete-artifact-set reason`,
    );
  }
});

test("the sealed snapshot binds to that bundle and its XLSX workbook", async () => {
  const db = sealableDb();
  const snapshot = await buildSealedSnapshot({ dealId: DEAL_ID, sb: db as any });
  const binding = snapshot.distributionBinding;
  assert.equal(binding.bundleId, "bundle-1");
  assert.equal(binding.creditMemoId, "memo-1");
  assert.equal(binding.spreadId, "spread-1");
  assert.equal(binding.artifacts.projectionsXlsx, `${DEAL_ID}/final/1_projections.xlsx`);
  assert.ok(
    !("projectionsPdf" in binding.artifacts),
    "the binding must not carry a projections PDF final mode never produces",
  );
});

test("sealed-package columns round-trip: what seal writes is what delivery reads", async () => {
  const db = sealableDb();
  const snapshot = await buildSealedSnapshot({ dealId: DEAL_ID, sb: db as any });

  // Exactly the columns the seal route persists.
  const columns = sealedPackageArtifactColumns(snapshot.distributionBinding);
  db.tables.buddy_sealed_packages.push({
    id: "sealed-1",
    deal_id: DEAL_ID,
    sealed_at: "2026-08-21T00:00:00.000Z",
    unsealed_at: null,
    final_credit_memo_path: null,
    final_forms_path: null,
    final_source_docs_zip_path: null,
    ...columns,
  });

  const manifest = await buildPackageManifest(DEAL_ID, "full", db as any);
  const byType = Object.fromEntries(manifest.resources.map((r) => [r.type, r]));

  // final_projections_path holds the XLSX — the column packageDelivery reads
  // it back out of. Writing the PDF path here (audit F-02) served a PDF under
  // a spreadsheet content type.
  assert.equal(byType.projections_xlsx.available, true);
  assert.equal(
    columns.final_projections_path,
    snapshot.distributionBinding.artifacts.projectionsXlsx,
  );
  assert.equal(byType.business_plan.available, true);
  assert.equal(byType.feasibility.available, true);

  // Final mode renders no projections PDF, and no fallback preview bundle
  // exists here, so the resource is correctly reported unavailable rather
  // than pointing at the workbook.
  assert.equal(byType.projections_pdf.available, false);
});

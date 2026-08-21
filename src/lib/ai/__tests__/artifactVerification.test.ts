/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — artifactVerification.ts (verifyArtifactAndFlag)
 * unit tests. Same fake-Supabase-client convention as
 * hostileInterrogation.test.ts (M6) — supports exactly the chains this
 * helper uses: select/eq/maybeSingle, insert (bare-awaited).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { verifyArtifactAndFlag } =
  require("../artifactVerification") as typeof import("../artifactVerification");
const { __setProviderImplForTests, __resetGatewayTestOverrides, __resetGatewayBudgetForTests } =
  require("../gateway") as typeof import("../gateway");

test.afterEach(() => {
  __resetGatewayTestOverrides();
  __resetGatewayBudgetForTests();
});

type Row = Record<string, any>;

function makeDb(
  tables: Record<string, Row[]>,
  failures: { select?: string; insert?: string } = {},
) {
  function builder(tableName: string) {
    const rows = tables[tableName] ?? (tables[tableName] = []);
    let filters: Array<[string, any]> = [];
    let op: "select" | "insert" = "select";
    let payload: any = null;

    function matches(row: Row) {
      return filters.every(([k, v]) => row[k] === v);
    }

    const q: any = {
      select() {
        return q;
      },
      eq(col: string, val: any) {
        filters.push([col, val]);
        return q;
      },
      insert(p: any) {
        op = "insert";
        payload = p;
        return q;
      },
      maybeSingle() {
        return Promise.resolve(exec());
      },
      then(onFulfilled: any, onRejected: any) {
        return execPromise().then(onFulfilled, onRejected);
      },
    };

    function exec(): { data: Row | null; error: { message: string } | null } {
      if (op === "insert") {
        if (failures.insert) return { data: null, error: { message: failures.insert } };
        rows.push({ id: `gen-${rows.length + 1}`, ...payload });
        return { data: null, error: null };
      }
      if (failures.select) return { data: null, error: { message: failures.select } };
      const found = rows.find(matches) ?? null;
      return { data: found, error: null };
    }

    async function execPromise() {
      return exec();
    }

    return q;
  }

  return { from: builder };
}

function setVerifierResponse(flaggedClaims: unknown[]) {
  __setProviderImplForTests("anthropic", async () => ({
    text: JSON.stringify({ flaggedClaims }),
    tokensIn: 50,
    tokensOut: 30,
  }));
}

test("verifyArtifactAndFlag passes through with no conditions when nothing is flagged", async () => {
  setVerifierResponse([]);
  const db = makeDb({});

  const result = await verifyArtifactAndFlag({
    dealId: "deal-1",
    bankId: "bank-1",
    artifactType: "credit_memo",
    sectionKey: "business_summary",
    facts: { dscr: 1.35 },
    draftText: "DSCR is comfortably above policy minimum.",
    sb: db,
  });

  assert.equal(result.verdict, "pass");
  assert.equal(result.conditionsCreated, 0);
  assert.equal(result.conditionsSkipped, 0);
});

test("verifyArtifactAndFlag opens a banker task for a critical claim but not an info claim", async () => {
  setVerifierResponse([
    { claim: "Revenue grew 40% YoY", reason: "Facts show 12%.", severity: "critical" },
    { claim: "The business has a strong reputation", reason: "Stylistic, unverifiable.", severity: "info" },
  ]);
  const tables: Record<string, Row[]> = {};
  const db = makeDb(tables);

  const result = await verifyArtifactAndFlag({
    dealId: "deal-1",
    bankId: "bank-1",
    artifactType: "business_plan",
    sectionKey: "executive_summary",
    facts: { revenue_growth_pct: 12 },
    draftText: "Revenue grew 40% YoY, and the business has a strong reputation.",
    sb: db,
  });

  assert.equal(result.verdict, "flagged");
  assert.equal(result.conditionsCreated, 1, "only the critical claim opens a task");
  assert.equal(tables.deal_conditions?.length, 1);
  assert.match(tables.deal_conditions[0].source_key, /^artifact_claim:business_plan:executive_summary:/);
});

test("verifyArtifactAndFlag is idempotent — re-running the same flagged claim does not duplicate the task", async () => {
  setVerifierResponse([{ claim: "DSCR exceeds 2.0x", reason: "Facts show 1.35x.", severity: "warning" }]);
  const tables: Record<string, Row[]> = {};
  const db = makeDb(tables);

  const input = {
    dealId: "deal-1",
    bankId: "bank-1",
    artifactType: "feasibility" as const,
    sectionKey: "financial_viability",
    facts: { dscr: 1.35 },
    draftText: "DSCR exceeds 2.0x, well above policy.",
    sb: db,
  };

  const first = await verifyArtifactAndFlag(input);
  const second = await verifyArtifactAndFlag(input);

  assert.equal(first.conditionsCreated, 1);
  assert.equal(second.conditionsCreated, 0, "second run must skip, not duplicate");
  assert.equal(second.conditionsSkipped, 1);
  assert.equal(tables.deal_conditions?.length, 1);
});

test("verifyArtifactAndFlag treats a verifier call failure as a critical flag, not a silent pass", async () => {
  __setProviderImplForTests("anthropic", async () => {
    throw new Error("provider unavailable");
  });
  const db = makeDb({});

  const result = await verifyArtifactAndFlag({
    dealId: "deal-1",
    bankId: "bank-1",
    artifactType: "projections_assumptions",
    sectionKey: "dscr_stack",
    facts: { dscr: 1.35 },
    draftText: "DSCR is 1.35x.",
    sb: db,
  });

  assert.equal(result.verdict, "flagged");
  assert.equal(result.flaggedClaims[0].severity, "critical");
  assert.equal(result.conditionsCreated, 1);
});

test("verifyArtifactAndFlag treats malformed verifier JSON as a critical flag that opens a task", async () => {
  __setProviderImplForTests("anthropic", async () => ({
    text: "not valid json",
    tokensIn: 10,
    tokensOut: 5,
  }));
  const tables: Record<string, Row[]> = {};
  const db = makeDb(tables);

  const result = await verifyArtifactAndFlag({
    dealId: "deal-1",
    bankId: "bank-1",
    artifactType: "credit_memo",
    sectionKey: "financial_analysis",
    facts: {},
    draftText: "some draft",
    sb: db,
  });

  assert.equal(result.verdict, "flagged");
  assert.equal(result.conditionsCreated, 1);
  assert.equal(tables.deal_conditions?.length, 1);
});


test("verifyArtifactAndFlag fails closed when the idempotency lookup errors", async () => {
  setVerifierResponse([
    { claim: "Revenue grew 40% YoY", reason: "Facts show 12%.", severity: "warning" },
  ]);
  const db = makeDb({}, { select: 'column "source_key" does not exist' });

  await assert.rejects(
    verifyArtifactAndFlag({
      dealId: "deal-1",
      bankId: "bank-1",
      artifactType: "credit_memo",
      sectionKey: "narratives",
      facts: { revenue_growth_pct: 12 },
      draftText: "Revenue grew 40% YoY.",
      sb: db,
    }),
    /Artifact condition lookup failed.*source_key/,
  );
});

test("verifyArtifactAndFlag fails closed when an actionable finding cannot persist", async () => {
  setVerifierResponse([
    { claim: "DSCR exceeds 2.0x", reason: "Facts show 1.35x.", severity: "critical" },
  ]);
  const db = makeDb({}, { insert: "write contract rejected" });

  await assert.rejects(
    verifyArtifactAndFlag({
      dealId: "deal-1",
      bankId: "bank-1",
      artifactType: "credit_memo",
      sectionKey: "narratives",
      facts: { dscr: 1.35 },
      draftText: "DSCR exceeds 2.0x.",
      sb: db,
    }),
    /Artifact condition persistence failed.*write contract rejected/,
  );
});

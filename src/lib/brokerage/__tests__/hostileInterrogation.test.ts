import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { runHostileInterrogationForDeal } =
  require("../hostileInterrogation") as typeof import("../hostileInterrogation");
const { __setProviderImplForTests, __resetGatewayTestOverrides, __resetGatewayBudgetForTests } =
  require("../../ai/gateway") as typeof import("../../ai/gateway");

test.afterEach(() => {
  __resetGatewayTestOverrides();
  __resetGatewayBudgetForTests();
});

// ─── Minimal in-memory Supabase stub ────────────────────────────────────
// Supports exactly the chains hostileInterrogation.ts uses: select/eq/
// order/limit/maybeSingle, upsert (onConflict-aware, bare-awaited or
// chained), insert (bare-awaited).
type Row = Record<string, any>;

function makeDb(tables: Record<string, Row[]>) {
  function builder(tableName: string) {
    const rows = tables[tableName] ?? (tables[tableName] = []);
    let filters: Array<[string, any]> = [];
    let op: "select" | "insert" | "upsert" = "select";
    let payload: any = null;
    let conflictKeys: string[] = [];

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
      order() {
        return q;
      },
      limit() {
        return q;
      },
      upsert(p: any, opts?: { onConflict?: string }) {
        op = "upsert";
        payload = p;
        conflictKeys = (opts?.onConflict ?? "").split(",").filter(Boolean);
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

    function exec(): { data: Row | null; error: null } {
      if (op === "insert") {
        rows.push({ id: `gen-${rows.length + 1}`, ...payload });
        return { data: null, error: null };
      }
      if (op === "upsert") {
        const existing = conflictKeys.length
          ? rows.find((r) => conflictKeys.every((k) => r[k] === payload[k]))
          : undefined;
        if (existing) Object.assign(existing, payload);
        else rows.push({ ...payload });
        return { data: null, error: null };
      }
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

const VALID_QUESTIONS = [
  {
    code: "dscr_thin_margin",
    question: "How does the deal survive a revenue decline?",
    domain: "repayment",
    severity: "critical",
    alreadyAnswered: false,
    rationale: "DSCR is thin.",
    resolvingAction: "Document a stress scenario.",
    borrowerResolvable: true,
  },
  {
    code: "management_depth",
    question: "Who runs the business if the owner is unavailable?",
    domain: "management",
    severity: "warning",
    alreadyAnswered: false,
    rationale: "No second-in-command documented.",
    resolvingAction: "Escalate to underwriting for a policy call.",
    borrowerResolvable: false,
  },
  {
    code: "already_covered",
    question: "What is the requested loan amount?",
    domain: "structure",
    severity: "info",
    alreadyAnswered: true,
    rationale: "Loan amount is on file.",
    resolvingAction: "None needed.",
    borrowerResolvable: true,
  },
];

function setVerifierResponse(questions: unknown[]) {
  __setProviderImplForTests("anthropic", async () => ({
    text: JSON.stringify({ questions }),
    tokensIn: 100,
    tokensOut: 100,
  }));
}

test("runHostileInterrogationForDeal persists all questions and opens conditions only for unanswered ones", async () => {
  setVerifierResponse(VALID_QUESTIONS);
  const db = makeDb({});

  const result = await runHostileInterrogationForDeal("deal-1", "bank-1", db);

  assert.equal(result.questions.length, 3);
  assert.equal(result.conditionsCreated, 2, "only the 2 unanswered questions open a condition");
  assert.equal(result.conditionsSkipped, 0);
});

test("runHostileInterrogationForDeal is idempotent — re-running does not duplicate conditions", async () => {
  setVerifierResponse(VALID_QUESTIONS);
  const db = makeDb({});

  const first = await runHostileInterrogationForDeal("deal-1", "bank-1", db);
  const second = await runHostileInterrogationForDeal("deal-1", "bank-1", db);

  assert.equal(first.conditionsCreated, 2);
  assert.equal(second.conditionsCreated, 0, "second run must skip, not duplicate");
  assert.equal(second.conditionsSkipped, 2);
});

test("runHostileInterrogationForDeal upserts by (deal_id, code) — a re-run replaces, not duplicates, appendix rows", async () => {
  setVerifierResponse(VALID_QUESTIONS);
  const tables: Record<string, Row[]> = {};
  const db = makeDb(tables);

  await runHostileInterrogationForDeal("deal-1", "bank-1", db);
  await runHostileInterrogationForDeal("deal-1", "bank-1", db);

  assert.equal(tables.deal_hostile_interrogations?.length, 3, "3 distinct codes, no duplicates across 2 runs");
});

test("runHostileInterrogationForDeal emits the anticipated_lender_followup beat metric", async () => {
  setVerifierResponse(VALID_QUESTIONS);
  const tables: Record<string, Row[]> = {};
  const db = makeDb(tables);

  await runHostileInterrogationForDeal("deal-1", "bank-1", db);

  const events = tables.brokerage_conversion_events ?? [];
  const anticipated = events.find((e) => e.event_type === "anticipated_lender_followup");
  assert.ok(anticipated, "expected an anticipated_lender_followup event");
  assert.equal(anticipated.metadata.questionCount, 3);
});

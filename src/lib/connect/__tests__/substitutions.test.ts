import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateDocumentSubstitutions } from "../substitutions";

/**
 * Regression coverage for the Stack-1 -> Stack-2 retarget: this engine
 * previously queried borrower_account_connections/connected_account_data,
 * tables that were never actually created live despite their migration
 * being recorded as applied — so it always silently returned zero
 * substitutions. It now targets the real, populated Stack-2 tables
 * (borrower_bank_connections/borrower_bank_accounts/
 * borrower_bank_transactions, borrower_irs_transcript_requests).
 */
function makeFakeSb(tables: Record<string, any[]> = {}) {
  const state: Record<string, any[]> = { ...tables };

  function table(name: string) {
    if (!state[name]) state[name] = [];
    const filters: Array<(row: any) => boolean> = [];
    let countMode = false;
    const builder: any = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.count) countMode = true;
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push((row) => row[col] === val);
        return builder;
      },
      in(col: string, vals: unknown[]) {
        filters.push((row) => vals.includes(row[col]));
        return builder;
      },
      maybeSingle: async () => {
        const rows = state[name].filter((r) => filters.every((f) => f(r)));
        return { data: rows[0] ?? null, error: null };
      },
      then(resolve: any) {
        const rows = state[name].filter((r) => filters.every((f) => f(r)));
        if (countMode) {
          resolve({ data: null, count: rows.length, error: null });
        } else {
          resolve({ data: rows, error: null });
        }
      },
      insert(row: any) {
        state[name].push({ id: `${name}-${state[name].length}`, ...row });
        return Promise.resolve({ data: null, error: null });
      },
    };
    return builder;
  }

  return { client: { from: table }, state };
}

function isoMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

test("evaluateDocumentSubstitutions: no connections or transcript requests -> zero substitutions", async () => {
  const { client } = makeFakeSb();
  const result = await evaluateDocumentSubstitutions({ dealId: "deal-1", bankId: "bank-1" }, { sb: client });
  assert.equal(result.substitutions_applied, 0);
});

test("evaluateDocumentSubstitutions: active business bank connection with 12mo history + transactions -> substitutes Business Bank Statements", async () => {
  const { client, state } = makeFakeSb({
    borrower_bank_connections: [
      {
        id: "conn-1",
        deal_id: "deal-1",
        ownership_entity_id: null, // no owner -> business account
        status: "active",
        earliest_transaction_date: isoMonthsAgo(13),
        latest_transaction_date: isoMonthsAgo(0),
      },
    ],
    borrower_bank_accounts: [{ id: "acct-1", connection_id: "conn-1" }],
    borrower_bank_transactions: [{ id: "txn-1", account_id: "acct-1" }],
  });

  const result = await evaluateDocumentSubstitutions({ dealId: "deal-1", bankId: "bank-1" }, { sb: client });

  assert.equal(result.substitutions_applied, 1);
  assert.equal(result.details[0].doc_requirement, "Business Bank Statements");
  assert.equal(state.document_substitutions.length, 1);
  assert.equal(state.document_substitutions[0].bank_connection_id, "conn-1");
});

test("evaluateDocumentSubstitutions: personal connection (ownership_entity_id set) with only 2mo history -> below 3mo threshold, no substitution", async () => {
  const { client } = makeFakeSb({
    borrower_bank_connections: [
      {
        id: "conn-2",
        deal_id: "deal-1",
        ownership_entity_id: "owner-1",
        status: "active",
        earliest_transaction_date: isoMonthsAgo(2),
        latest_transaction_date: isoMonthsAgo(0),
      },
    ],
  });

  const result = await evaluateDocumentSubstitutions({ dealId: "deal-1", bankId: "bank-1" }, { sb: client });
  assert.equal(result.substitutions_applied, 0);
});

test("evaluateDocumentSubstitutions: reconciled IRS transcript request with 3 tax years -> substitutes Business Tax Returns", async () => {
  const { client, state } = makeFakeSb({
    borrower_irs_transcript_requests: [
      {
        id: "req-1",
        deal_id: "deal-1",
        ownership_entity_id: null,
        status: "reconciled",
        tax_years: [2021, 2022, 2023],
      },
    ],
  });

  const result = await evaluateDocumentSubstitutions({ dealId: "deal-1", bankId: "bank-1" }, { sb: client });

  assert.equal(result.substitutions_applied, 1);
  assert.equal(result.details[0].doc_requirement, "Business Tax Returns");
  assert.equal(state.document_substitutions[0].irs_request_id, "req-1");
});

test("evaluateDocumentSubstitutions: already-substituted requirement -> not duplicated on rerun", async () => {
  const { client } = makeFakeSb({
    borrower_irs_transcript_requests: [
      {
        id: "req-1",
        deal_id: "deal-1",
        ownership_entity_id: "owner-1",
        status: "received",
        tax_years: [2022, 2023],
      },
    ],
    document_substitutions: [
      {
        id: "sub-1",
        deal_id: "deal-1",
        original_doc_requirement: "Personal Tax Returns",
        substituted_by: "irs_transcript",
      },
    ],
  });

  const result = await evaluateDocumentSubstitutions({ dealId: "deal-1", bankId: "bank-1" }, { sb: client });
  assert.equal(result.substitutions_applied, 0);
});

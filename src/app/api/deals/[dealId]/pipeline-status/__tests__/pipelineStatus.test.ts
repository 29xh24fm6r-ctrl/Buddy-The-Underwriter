import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * pipeline-status route — structural invariant tests
 *
 * Validates exports, auth patterns, and implementation constraints
 * without requiring a running database.
 */

describe("pipeline-status route", () => {
  it("exports GET handler (source check)", () => {
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const source = readFileSync(
      resolve(__dirname, "../route.ts"),
      "utf-8",
    );

    assert.ok(
      source.includes("export async function GET"),
      "must export GET handler",
    );
  });

  it("uses requireRoleApi (not bare requireRole call)", () => {
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const source = readFileSync(
      resolve(__dirname, "../route.ts"),
      "utf-8",
    );

    assert.ok(
      source.includes("requireRoleApi"),
      "must use requireRoleApi for API routes",
    );
    // Ensure no bare requireRole( calls (the function call pattern, not the import path)
    assert.ok(
      !source.match(/await\s+requireRole\(/),
      "must NOT call bare requireRole() — use requireRoleApi()",
    );
  });

  it("uses ensureDealBankAccess for bank-scoped auth", async () => {
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const source = readFileSync(
      resolve(__dirname, "../route.ts"),
      "utf-8",
    );

    assert.ok(
      source.includes("ensureDealBankAccess"),
      "must use ensureDealBankAccess for tenant-scoped access",
    );
  });

  it("uses Promise.all for parallel queries", async () => {
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const source = readFileSync(
      resolve(__dirname, "../route.ts"),
      "utf-8",
    );

    assert.ok(
      source.includes("Promise.all"),
      "must use Promise.all for parallel DB queries",
    );
  });

  it("includes rethrowNextErrors in catch block", async () => {
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const source = readFileSync(
      resolve(__dirname, "../route.ts"),
      "utf-8",
    );

    assert.ok(
      source.includes("rethrowNextErrors"),
      "must include rethrowNextErrors safety net",
    );
  });

  it("does not import from next/dist internals", async () => {
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const source = readFileSync(
      resolve(__dirname, "../route.ts"),
      "utf-8",
    );

    assert.ok(
      !source.includes("next/dist"),
      "must NOT import from next/dist internals",
    );
  });

  it("queries all 6 data sources", async () => {
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const source = readFileSync(
      resolve(__dirname, "../route.ts"),
      "utf-8",
    );

    const tables = [
      "deal_documents",
      "document_jobs",
      "deal_spread_jobs",
      "deal_financial_facts",
      "deal_spreads",
      "deal_pipeline_ledger",
    ];

    for (const table of tables) {
      assert.ok(
        source.includes(`"${table}"`),
        `must query ${table}`,
      );
    }
  });
});

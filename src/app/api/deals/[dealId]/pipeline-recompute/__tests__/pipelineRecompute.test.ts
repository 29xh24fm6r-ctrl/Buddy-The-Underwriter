import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * pipeline-recompute route — structural invariant tests
 *
 * Validates exports, auth patterns, scope handling, and
 * implementation constraints without requiring a running database.
 */

describe("pipeline-recompute route", () => {
  it("exports POST handler (source check)", () => {
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const source = readFileSync(
      resolve(__dirname, "../route.ts"),
      "utf-8",
    );

    assert.ok(
      source.includes("export async function POST"),
      "must export POST handler",
    );
  });

  it("uses requireRoleApi with super_admin only", () => {
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
    assert.ok(
      source.includes('"super_admin"'),
      "must restrict to super_admin",
    );
    // Should NOT include bank_admin or underwriter in the allowed roles
    assert.ok(
      !source.match(/requireRoleApi\(\[.*"bank_admin"/),
      "must NOT allow bank_admin for recompute",
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

  it("validates scope parameter", async () => {
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const source = readFileSync(
      resolve(__dirname, "../route.ts"),
      "utf-8",
    );

    assert.ok(source.includes("VALID_SCOPES"), "must validate scope");
    assert.ok(source.includes('"ALL"'), "must support ALL scope");
    assert.ok(source.includes('"DOCS"'), "must support DOCS scope");
    assert.ok(source.includes('"EXTRACT"'), "must support EXTRACT scope");
    assert.ok(source.includes('"SPREADS"'), "must support SPREADS scope");
  });

  it("calls enqueueSpreadRecompute for SPREADS scope", async () => {
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const source = readFileSync(
      resolve(__dirname, "../route.ts"),
      "utf-8",
    );

    assert.ok(
      source.includes("enqueueSpreadRecompute"),
      "must call enqueueSpreadRecompute for spread recompute",
    );
  });

  it("writes to deal_pipeline_ledger", async () => {
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const source = readFileSync(
      resolve(__dirname, "../route.ts"),
      "utf-8",
    );

    assert.ok(
      source.includes("logPipelineLedger"),
      "must write ledger event via logPipelineLedger",
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
});

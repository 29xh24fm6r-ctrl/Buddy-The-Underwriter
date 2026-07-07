/**
 * SPEC-SEC-1 — assertDealAccess fail-closed status matrix.
 *
 * assertDealAccess/resolveDealAccess depend on Clerk + Supabase, which the
 * repo's node --test setup does not mock. The security-critical logic — mapping
 * a resolved access result to a deny status — is extracted as the pure function
 * dealAccessResultToError, tested here directly.
 *
 * Also asserts the co-located route glue (withDealAccess.ts) exists and
 * translates typed AccessErrors to the right HTTP status.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { dealAccessResultToError } from "../dealAccessResult";
import type { DealAccessResult } from "../dealAccessResult";
import {
  AuthenticationRequiredError,
  DealAccessDeniedError,
} from "../access-errors";

describe("dealAccessResultToError — fail-closed status matrix", () => {
  it("no authenticated user → 401 (AuthenticationRequiredError)", () => {
    const err = dealAccessResultToError({
      accessible: false,
      reason: "unauthorized",
      detail: "not_authenticated",
    });
    assert.ok(err instanceof AuthenticationRequiredError);
    assert.equal(err.status, 401);
  });

  it("user in bank A, deal in bank B → 403 (tenant_mismatch)", () => {
    const err = dealAccessResultToError({
      accessible: false,
      reason: "tenant_mismatch",
      detail: "user bank A != deal bank B",
    });
    assert.ok(err instanceof DealAccessDeniedError);
    assert.equal(err.status, 403);
  });

  it("deal not found → 404 (not a success)", () => {
    for (const reason of ["not_found", "deal_not_found"] as const) {
      const err = dealAccessResultToError({ accessible: false, reason });
      assert.ok(err instanceof DealAccessDeniedError);
      assert.equal(err.status, 404);
    }
  });

  it("accessible result → null (no error thrown)", () => {
    const ok: DealAccessResult = {
      accessible: true,
      dealId: "d1",
      bankId: "b1",
      userId: "u1",
      source: "membership",
    };
    assert.equal(dealAccessResultToError(ok), null);
  });

  it("fails closed: every denied reason maps to a deny status, never success", () => {
    const reasons: DealAccessResult[] = [
      { accessible: false, reason: "unauthorized" },
      { accessible: false, reason: "deal_not_found" },
      { accessible: false, reason: "not_found" },
      { accessible: false, reason: "tenant_mismatch" },
    ];
    for (const r of reasons) {
      const err = dealAccessResultToError(r);
      assert.ok(err, `reason ${(r as any).reason} must produce an error`);
      assert.ok([401, 403, 404].includes(err.status));
    }
  });
});

describe("route glue — deal-access.ts + withDealAccess.ts contract", () => {
  const serverDir = path.resolve(__dirname, "..");

  it("dealAccessResult.ts holds the pure mapper (no server-only import)", () => {
    const content = fs.readFileSync(path.join(serverDir, "dealAccessResult.ts"), "utf8");
    assert.ok(content.includes("export function dealAccessResultToError"));
    assert.ok(!content.includes('"server-only"'), "pure module must not import server-only");
  });

  it("deal-access.ts re-exports the mapper + defines assertDealAccess", () => {
    const content = fs.readFileSync(path.join(serverDir, "deal-access.ts"), "utf8");
    assert.ok(content.includes("dealAccessResultToError"));
    assert.ok(content.includes("export async function assertDealAccess"));
  });

  it("withDealAccess.ts exports accessErrorToResponse + withDealAccess", () => {
    const content = fs.readFileSync(path.join(serverDir, "withDealAccess.ts"), "utf8");
    assert.ok(content.includes("export function accessErrorToResponse"));
    assert.ok(content.includes("export function withDealAccess"));
    // Must map an AccessError to its own status, not a blanket 500.
    assert.ok(content.includes("isAccessError"));
    assert.ok(content.includes("err.status"));
  });
});

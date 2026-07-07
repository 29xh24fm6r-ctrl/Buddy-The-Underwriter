/**
 * SPEC-SEC-1 — regression contract for the routes patched in this spec.
 *
 * Static assertions (the repo's auth-test idiom — see authTenantGuard.test.ts):
 * every named critical route must assert deal access before its side effects,
 * and the E-Tran approve path must stamp the real user, never 'system'.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const API = path.resolve(__dirname, "../../../app/api/deals/[dealId]");

function read(rel: string): string {
  return fs.readFileSync(path.join(API, rel), "utf8");
}

const PATCHED_ROUTES = [
  "signals/route.ts",
  "etran/submit/route.ts",
  "summary/route.ts",
  "messages/route.ts",
  "bank/route.ts",
  "entities/route.ts",
  "portal/revoke/route.ts",
  "portal/messages/send/route.ts",
  "drafts/[draftId]/approve/route.ts",
  "memos/generate/route.ts",
  "pricing-quotes/create/route.ts",
];

describe("SPEC-SEC-1 patched routes assert deal access", () => {
  for (const rel of PATCHED_ROUTES) {
    it(`${rel} calls assertDealAccess and translates AccessErrors`, () => {
      const content = read(rel);
      assert.ok(
        content.includes("assertDealAccess("),
        `${rel} must call assertDealAccess`,
      );
      assert.ok(
        content.includes("accessErrorToResponse("),
        `${rel} must translate AccessError → response`,
      );
    });
  }
});

describe("SPEC-SEC-1 signals route no longer disables auth", () => {
  it("removes the commented-out auth TODO", () => {
    const content = read("signals/route.ts");
    assert.ok(
      !content.includes("Re-enable auth when Clerk is properly configured"),
      "signals route must not carry the auth-disabled TODO",
    );
    assert.ok(!content.includes("requireUnderwriterOnDeal"));
  });
});

describe("SPEC-SEC-1 etran submit records the real user", () => {
  it("PATCH stamps submitted_by from the authenticated userId, not 'system'", () => {
    const content = read("etran/submit/route.ts");
    assert.ok(
      !content.includes('submitted_by: "system"'),
      "etran approve must not hardcode submitted_by: 'system'",
    );
    assert.ok(
      content.includes("submitted_by: userId"),
      "etran approve must stamp submitted_by from assertDealAccess userId",
    );
  });
});

describe("SPEC-SEC-1 entities route stamps the real user", () => {
  it("POST no longer inserts user_id: 'dev-user'", () => {
    const content = read("entities/route.ts");
    assert.ok(
      !content.includes('user_id: "dev-user"'),
      "entities POST must not hardcode user_id: 'dev-user'",
    );
    assert.ok(content.includes("user_id: userId"));
  });
});

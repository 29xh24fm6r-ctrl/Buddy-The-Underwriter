/**
 * Phase 53C — Borrower Portal Auth + Deal Assignment + Seed Gate CI Guard
 *
 * Test suites:
 * A. Portal upload auth boundary — borrower flows must not hit Clerk-only endpoints
 * B. Deal assignment enforcement — old stub must delegate to real participants.ts
 * C. Seed route gating — must be blocked in production
 * D. Staff/borrower route separation — no mixed auth boundaries
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "../../..");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// A. Portal upload auth boundary
// ---------------------------------------------------------------------------

describe("Portal upload auth boundary", () => {
  it("borrower portal page uses /api/portal/[token]/ route for file record, not /api/deals/", () => {
    const content = readFile("app/(app)/borrower/portal/[token]/page.tsx");

    // Must call the token-authed portal route
    assert.ok(
      content.includes("/api/portal/") && content.includes("/files/record"),
      "portal page must call /api/portal/[token]/files/record",
    );

    // Must NOT call the Clerk-authed deals route for file record
    const lines = content.split("\n");
    const clerkFileRecordCalls = lines.filter(
      (l) => l.includes("/api/deals/") && l.includes("/files/record") && !l.trim().startsWith("//"),
    );
    assert.equal(
      clerkFileRecordCalls.length,
      0,
      `Portal page must not call Clerk-authed /api/deals/.../files/record:\n${clerkFileRecordCalls.join("\n")}`,
    );
  });

  it("portal file record route uses token auth, not Clerk", () => {
    const content = readFile("app/api/portal/[token]/files/record/route.ts");

    // Must validate borrower_portal_links token
    assert.ok(
      content.includes("borrower_portal_links"),
      "portal file record must validate against borrower_portal_links",
    );

    // Must NOT import clerkAuth
    assert.ok(
      !content.includes("clerkAuth"),
      "portal file record must not use Clerk auth",
    );
  });

  it("staff file record route requires Clerk auth", () => {
    const content = readFile("app/api/deals/[dealId]/files/record/route.ts");
    assert.ok(
      content.includes("clerkAuth") || content.includes("requireUser") || content.includes("requireDealCockpitAccess"),
      "staff file record route must require Clerk/session auth",
    );
  });
});

// ---------------------------------------------------------------------------
// B. Deal assignment enforcement
// ---------------------------------------------------------------------------

describe("Deal assignment enforcement", () => {
  it("old stub re-exports from participants.ts (not inline stub)", () => {
    const content = readFile("lib/auth/requireUnderwriterOnDeal.ts");

    // Must re-export from participants, not be an inline stub
    assert.ok(
      content.includes("@/lib/deals/participants"),
      "requireUnderwriterOnDeal must delegate to participants.ts",
    );

    // Must NOT contain the old stub pattern (checking auth without assignment)
    assert.ok(
      !content.includes("_dealId"),
      "must not contain unused _dealId parameter (old stub pattern)",
    );
  });

  it("participants.ts checks deal_participants table", () => {
    const content = readFile("lib/deals/participants.ts");
    assert.ok(
      content.includes("deal_participants"),
      "participants.ts must query deal_participants table",
    );
    assert.ok(
      content.includes("is_active"),
      "participants.ts must check is_active flag",
    );
    assert.ok(
      content.includes('"underwriter"') || content.includes("'underwriter'"),
      "participants.ts must check underwriter role",
    );
  });

  it("no routes import the old stub path with inline auth-only check", () => {
    // The old stub at @/lib/auth/requireUnderwriterOnDeal is now a re-export.
    // Verify the re-export file doesn't contain inline auth logic.
    const content = readFile("lib/auth/requireUnderwriterOnDeal.ts");
    assert.ok(
      !content.includes("async function requireUnderwriterOnDeal"),
      "old file must not define an inline function (must re-export only)",
    );
  });
});

// ---------------------------------------------------------------------------
// C. Seed route gating
// ---------------------------------------------------------------------------

describe("Seed route gating", () => {
  // The flat /api/deals/seed route was removed in 824c90f7 ("remove 18 dead
  // routes to stay under Vercel 2048 cap"). A non-existent route is the
  // strongest possible gating — there is nothing to invoke. This guard now
  // pins that removal: if the route is ever re-introduced, the gating tests
  // (prod-block / auth / logging) must be restored alongside it.
  it("flat seed route stays removed (gating-by-absence)", () => {
    const seedRoutePath = path.join(SRC_ROOT, "app/api/deals/seed/route.ts");
    assert.ok(
      !fs.existsSync(seedRoutePath),
      "app/api/deals/seed/route.ts was removed in the route-cap cleanup — if re-added, restore the prod-block/auth/logging gating tests",
    );
  });
});

// ---------------------------------------------------------------------------
// D. Staff/borrower route separation
// ---------------------------------------------------------------------------

describe("Staff/borrower auth boundary separation", () => {
  it("borrower portal pages do not import clerkAuth directly", () => {
    const portalPage = readFile("app/(app)/borrower/portal/[token]/page.tsx");
    assert.ok(
      !portalPage.includes("clerkAuth"),
      "borrower portal page must not import or use clerkAuth",
    );
  });

  it("portal file sign route uses token auth", () => {
    const signRoute = readFile("app/api/borrower/portal/[token]/files/sign/route.ts");
    assert.ok(
      signRoute.includes("borrower_portal_links") || signRoute.includes("token"),
      "portal file sign route must validate portal token",
    );
    assert.ok(
      !signRoute.includes("clerkAuth"),
      "portal file sign route must not use Clerk auth",
    );
  });
});

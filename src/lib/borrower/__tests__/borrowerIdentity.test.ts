import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  hasLegalBorrowerIdentity,
  hasBorrowerNarrative,
  hasManagementSponsorProfile,
  hasLegalBorrowerIdentityForDeal,
} from "@/lib/borrower/borrowerIdentity";

/**
 * SPEC-BORROWER-ENTITY-SPONSOR-SEPARATION-1
 *
 * Legal borrower IDENTITY is a different credit concept from the
 * management/sponsor/guarantor PROFILE. A management profile alone must NEVER
 * satisfy legal borrower identity. A deal with a borrower_name (but no
 * borrower_id) IS identified and must not emit borrower_not_attached.
 */

// ── hasLegalBorrowerIdentity (pure) ──────────────────────────────────────────

test("[identity] borrower_id satisfies legal identity", () => {
  assert.equal(hasLegalBorrowerIdentity({ borrowerId: "b-1" }), true);
});

test("[identity] borrower_name satisfies legal identity", () => {
  assert.equal(
    hasLegalBorrowerIdentity({ borrowerName: "Omnicare 6-18-2026" }),
    true,
  );
});

test("[identity] deal name / display_name satisfy legal identity", () => {
  assert.equal(hasLegalBorrowerIdentity({ dealName: "Acme LLC" }), true);
  assert.equal(hasLegalBorrowerIdentity({ displayName: "Acme" }), true);
});

test("[identity] borrower story legal_name satisfies legal identity", () => {
  assert.equal(
    hasLegalBorrowerIdentity({ storyLegalName: "Acme Holdings Inc." }),
    true,
  );
});

test("[identity] whitespace-only fields do NOT satisfy legal identity", () => {
  assert.equal(
    hasLegalBorrowerIdentity({
      borrowerName: "   ",
      dealName: "",
      displayName: "\t",
      storyLegalName: null,
    }),
    false,
  );
});

test("[identity] nothing present → not identified", () => {
  assert.equal(hasLegalBorrowerIdentity({}), false);
  assert.equal(hasLegalBorrowerIdentity({ borrowerId: null }), false);
});

// ── management profile must NOT satisfy legal identity ────────────────────────

test("[separation] a management profile alone does NOT satisfy legal borrower identity", () => {
  // hasLegalBorrowerIdentity has no field for management profiles at all — the
  // type makes it impossible to pass one in. This is the structural guarantee.
  assert.equal(hasManagementSponsorProfile({ managementProfileCount: 3 }), true);
  // ...but the deal is still unidentified if it has no identity fields.
  assert.equal(hasLegalBorrowerIdentity({}), false);
});

// ── hasBorrowerNarrative (pure) ───────────────────────────────────────────────

test("[narrative] business_description / revenue_model satisfy narrative", () => {
  assert.equal(
    hasBorrowerNarrative({ businessDescription: "Sells widgets" }),
    true,
  );
  assert.equal(hasBorrowerNarrative({ revenueModel: "Subscription" }), true);
  assert.equal(hasBorrowerNarrative({}), false);
});

// ── hasManagementSponsorProfile (pure) ────────────────────────────────────────

test("[profile] satisfied only when at least one profile exists", () => {
  assert.equal(hasManagementSponsorProfile({ managementProfileCount: 0 }), false);
  assert.equal(hasManagementSponsorProfile({ managementProfileCount: 1 }), true);
});

// ── async accessor ────────────────────────────────────────────────────────────

function fakeSb(storyLegalName: string | null) {
  return {
    from(_table: string) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async limit() {
          return { data: [{ legal_name: storyLegalName }], error: null };
        },
      };
    },
  };
}

test("[accessor] borrower_name on the deal → identified without querying the story", async () => {
  // Even if the story has no legal_name, the deal-level borrower_name wins.
  const sb = fakeSb(null);
  assert.equal(
    await hasLegalBorrowerIdentityForDeal(sb, "deal-1", {
      borrower_name: "Omnicare 6-18-2026",
    }),
    true,
  );
});

test("[accessor] no deal identity but story legal_name present → identified", async () => {
  const sb = fakeSb("Acme Holdings Inc.");
  assert.equal(
    await hasLegalBorrowerIdentityForDeal(sb, "deal-1", {}),
    true,
  );
});

test("[accessor] no deal identity and no story legal_name → NOT identified", async () => {
  const sb = fakeSb(null);
  assert.equal(
    await hasLegalBorrowerIdentityForDeal(sb, "deal-1", {
      borrower_id: null,
      borrower_name: null,
      name: null,
      display_name: null,
    }),
    false,
  );
});

// ── cross-layer source contract ───────────────────────────────────────────────

test("lifecycle / underwrite / next-step all gate borrower on legal identity", () => {
  const root = process.cwd();
  const files = {
    verifyUnderwriteCore: "src/lib/deals/verifyUnderwriteCore.ts",
    deriveLifecycleState: "src/buddy/lifecycle/deriveLifecycleState.ts",
    computeNextStep: "src/core/nextStep/computeNextStep.ts",
  } as const;

  for (const [name, rel] of Object.entries(files)) {
    const src = fs.readFileSync(path.resolve(root, rel), "utf8");
    assert.ok(
      /hasLegalBorrowerIdentityForDeal/.test(src),
      `${name} must gate borrower on legal borrower identity`,
    );
    assert.ok(
      !/hasBorrowerRepresentation/.test(src),
      `${name} must NOT use the broad representation check (management profile must not satisfy legal identity)`,
    );
  }
});

test("borrower_not_attached CTA confirms identity and does not route to /borrower", () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/buddy/lifecycle/nextAction.ts"),
    "utf8",
  );
  assert.ok(
    /"Confirm borrower identity"/.test(src),
    "borrower_not_attached label must be 'Confirm borrower identity'",
  );
  assert.ok(
    !/label: "Attach borrower"/.test(src),
    "the old 'Attach borrower' label must be gone",
  );
});

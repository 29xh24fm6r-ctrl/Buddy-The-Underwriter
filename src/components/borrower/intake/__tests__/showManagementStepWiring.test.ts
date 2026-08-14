/**
 * SPEC-BORROWER-STRUCTURED-ASSUMPTIONS-1 — structural tripwires for the
 * showManagementStep prop, same source-grep convention as
 * assumptionInterviewConfirmWiring.test.ts (no jsdom precedent in this
 * repo for "use client" hook components).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSrc(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

test("TRIPWIRE: AssumptionInterview accepts showManagementStep, default true (admin-portal /apply usage unaffected)", () => {
  const src = readSrc("src/components/borrower/intake/AssumptionInterview.tsx");
  assert.match(src, /showManagementStep\?:\s*boolean/);
  assert.match(src, /showManagementStep\s*=\s*true/);
});

test("TRIPWIRE: visibleSubSteps filters out management when showManagementStep is false", () => {
  const src = readSrc("src/components/borrower/intake/AssumptionInterview.tsx");
  assert.match(src, /SUB_STEPS\.filter\(\(s\)\s*=>\s*s\.key\s*!==\s*"management"\)/);
});

test("TRIPWIRE: no remaining bare SUB_STEPS references in navigation/rendering (all replaced with visibleSubSteps)", () => {
  const src = readSrc("src/components/borrower/intake/AssumptionInterview.tsx");
  // Only the module-level const definition and the two expressions that
  // build visibleSubSteps from it should reference the raw SUB_STEPS name.
  const matches = src.match(/\bSUB_STEPS\b/g) ?? [];
  assert.equal(matches.length, 3, `expected exactly 3 SUB_STEPS references (definition + ternary), got ${matches.length}`);
});

test("TRIPWIRE: management sub-step JSX is gated on showManagementStep", () => {
  const src = readSrc("src/components/borrower/intake/AssumptionInterview.tsx");
  assert.match(src, /\{showManagementStep\s*&&\s*subStep === "management" && \(/);
});

test("TRIPWIRE: IntakeAssumptionsStep mounts AssumptionInterview with showManagementStep={false}", () => {
  const src = readSrc("src/components/borrower/intake/IntakeAssumptionsStep.tsx");
  assert.match(src, /showManagementStep=\{false\}/);
});

test("TRIPWIRE: IntakeOwnershipStep renders ManagementTeamFields", () => {
  const src = readSrc("src/components/borrower/intake/IntakeOwnershipStep.tsx");
  assert.match(src, /<ManagementTeamFields/);
});

test("TRIPWIRE: ManagementTeamFields persists to the SAME sba-assumptions route AssumptionInterview uses (one source of truth)", () => {
  const managementSrc = readSrc("src/components/borrower/intake/ManagementTeamFields.tsx");
  const interviewSrc = readSrc("src/components/borrower/intake/AssumptionInterview.tsx");
  assert.match(managementSrc, /\/api\/borrower\/portal\/\$\{token\}\/sba-assumptions/);
  assert.match(interviewSrc, /\/api\/borrower\/portal\/\$\{token\}\/sba-assumptions/);
});

test("TRIPWIRE: ManagementTeamFields PATCHes managementTeam under the same 'patch' envelope the route expects", () => {
  const src = readSrc("src/components/borrower/intake/ManagementTeamFields.tsx");
  assert.match(src, /patch:\s*\{\s*managementTeam:\s*next\s*\}/);
});

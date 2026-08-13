import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

/**
 * SPEC-BORROWER-APPLICATION-DISCOVERY-1 — scope guard for
 * fix/borrower-application-discovery.
 *
 * The concierge/chat fix and the Gemini/OpenAI gateway work are FROZEN —
 * verified working in production (PR #797) and must not be touched here.
 *
 * This fix's core is listBorrowerApplications.ts, but making a query
 * failure observable (rather than silently folded into "zero
 * applications") necessarily touches the exact call sites that previously
 * did that folding: emailVerification.ts's resolveOrCreateVerifiedBorrowerSession
 * (adds a new lookup_failed branch, does not change the existing OTP/
 * cookie/no-auto-resume logic), and applications/route.ts's GET/POST
 * handlers (adds try/catch around the existing calls, does not change
 * ownership/bucket/session logic). This guard pins the exact reviewed set
 * so any additional file is a deliberate, visible decision — not scope
 * creep — rather than asserting a false "these files are untouched"
 * claim.
 */

const FROZEN_FILES = [
  "src/lib/brokerage/borrowerConversation.ts",
  "src/lib/ai/providers/google.ts",
  "src/lib/ai/providers/openai.ts",
  "src/lib/ai/gateway.ts",
  "src/lib/ai/roleConfig.ts",
  "src/lib/ai/geminiClient.ts",
  "src/app/api/brokerage/concierge/route.ts",
  "src/app/(borrower)/welcome-back/WelcomeBackClient.tsx",
  "src/lib/brokerage/applicationChooser.ts",
  "src/lib/brokerage/sessionToken.ts",
];

const ALLOWED_NON_TEST_FILES = new Set([
  "src/lib/brokerage/listBorrowerApplications.ts",
  "src/lib/brokerage/emailVerification.ts",
  "src/app/api/brokerage/session/route.ts",
  "src/app/api/brokerage/session/applications/route.ts",
]);

function onExpectedBranch(): boolean {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
    }).trim();
    return branch === "fix/borrower-application-discovery";
  } catch {
    return false;
  }
}

function changedFiles(): string[] | null {
  try {
    execSync("git fetch origin main --quiet", { encoding: "utf8" });
  } catch {
    // Offline/no-remote CI checkout — merge-base may still resolve locally.
  }
  try {
    const base = execSync("git merge-base origin/main HEAD", {
      encoding: "utf8",
    }).trim();
    const out = execSync(`git diff --name-only ${base}...HEAD`, {
      encoding: "utf8",
    });
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

test("REGRESSION: concierge/chat/gateway files remain byte-untouched by this branch", () => {
  if (!onExpectedBranch()) return;
  const files = changedFiles();
  if (files === null) return;
  const touchedFrozenFiles = files.filter((f) => FROZEN_FILES.includes(f));
  assert.deepEqual(
    touchedFrozenFiles,
    [],
    `frozen file(s) modified by this branch: ${touchedFrozenFiles.join(", ")}`,
  );
});

test("REGRESSION: this branch's non-test file changes match the exact reviewed set (no unreviewed scope creep)", () => {
  if (!onExpectedBranch()) return;
  const files = changedFiles();
  if (files === null) return;
  const nonTestChanges = files.filter(
    (f) => !f.includes("__tests__") && !f.includes(".test.ts"),
  );
  for (const f of nonTestChanges) {
    assert.ok(
      ALLOWED_NON_TEST_FILES.has(f),
      `unexpected non-test file changed outside the reviewed scope: ${f}`,
    );
  }
});

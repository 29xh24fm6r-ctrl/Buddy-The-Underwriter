import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

/**
 * SPEC-WELCOME-BACK-ZERO-APP-SESSION-1 — scope guard.
 *
 * The concierge/chat fix (schema + provider work, landed separately on
 * fix/concierge-empty-message-fallback) is FROZEN. On the original narrow
 * branch (fix/welcome-back-zero-app-session), that branch must touch only
 * the two files this fix is scoped to — diffed against its merge-base with
 * origin/main, asserting none of the frozen files appear. Same fail-safe
 * execSync convention as vertexSdkGuard.test.ts (falls back to a no-op
 * rather than a hard crash if git/origin/main isn't available in a given
 * CI checkout).
 *
 * SPEC-INTEGRATION-BORROWER-CHAT-AND-SESSION-1 — this invariant is a
 * statement about THAT branch's own diff, not a general rule for every
 * branch. integration/borrower-chat-and-session-fixes deliberately merges
 * both fix/concierge-empty-message-fallback and
 * fix/welcome-back-zero-app-session, so the frozen files are intentionally
 * present there — asserting their absence on that branch would be testing
 * the wrong thing, not catching a real regression. Both checks below only
 * run when HEAD is actually the original scoped branch; anywhere else
 * (e.g. the integration branch) they no-op, since the invariant they
 * encode doesn't apply.
 */

function onOriginalScopedBranch(): boolean {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
    }).trim();
    return branch === "fix/welcome-back-zero-app-session";
  } catch {
    return false;
  }
}

const FROZEN_FILES = [
  "src/lib/brokerage/borrowerConversation.ts",
  "src/lib/ai/providers/google.ts",
  "src/lib/ai/providers/openai.ts",
  "src/lib/ai/gateway.ts",
  "src/lib/ai/roleConfig.ts",
  "src/lib/ai/geminiClient.ts",
  "src/app/api/brokerage/concierge/route.ts",
  "src/lib/brokerage/listBorrowerApplications.ts",
  "src/lib/brokerage/applicationChooser.ts",
  "src/app/api/brokerage/session/applications/route.ts",
  "src/lib/brokerage/sessionToken.ts",
];

const ALLOWED_FILES = new Set([
  "src/lib/brokerage/emailVerification.ts",
  "src/app/(borrower)/welcome-back/WelcomeBackClient.tsx",
]);

function changedFiles(): string[] | null {
  try {
    execSync("git fetch origin main --quiet", { encoding: "utf8" });
  } catch {
    // Offline/no-remote CI checkout — fall through, merge-base may still
    // resolve against a local origin/main ref.
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

test("REGRESSION: this branch's diff vs main never touches a frozen concierge/chat/session-security file", () => {
  if (!onOriginalScopedBranch()) return;
  const files = changedFiles();
  if (files === null) {
    // No git/origin available in this environment — cannot compute the
    // diff, so there is nothing meaningful to assert. Skip rather than
    // false-fail the suite (matches vertexSdkGuard.test.ts's fail-open
    // convention for environment-dependent shell calls).
    return;
  }
  const touchedFrozenFiles = files.filter((f) => FROZEN_FILES.includes(f));
  assert.deepEqual(
    touchedFrozenFiles,
    [],
    `frozen file(s) modified by this branch: ${touchedFrozenFiles.join(", ")}`,
  );
});

test("REGRESSION: this branch's diff vs main only touches the two files this fix is scoped to (plus new test files)", () => {
  if (!onOriginalScopedBranch()) return;
  const files = changedFiles();
  if (files === null) return;
  const nonTestChanges = files.filter(
    (f) => !f.includes("__tests__") && !f.includes(".test.ts"),
  );
  for (const f of nonTestChanges) {
    assert.ok(
      ALLOWED_FILES.has(f),
      `unexpected non-test file changed outside the approved scope: ${f}`,
    );
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSrc(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const SCREEN = "src/components/brokerage/ApplicationChooserScreen.tsx";
const CLIENT = "src/app/(borrower)/start/StartConciergeClient.tsx";
const GATE = "src/components/brokerage/BorrowerWorkspaceGate.tsx";

// --- Copy requirements ---

test("Welcome Back heading and message are present verbatim", () => {
  const src = readSrc(SCREEN);
  assert.match(src, />Welcome back</);
  assert.match(src, /We found an existing SBA package associated with your verified email\./);
});

test("Active applications use 'Continue Application', completed use 'View Completed Package'", () => {
  const src = readSrc(SCREEN);
  assert.match(src, /"Continue Application"/);
  assert.match(src, /"View Completed Package"/);
  // Completed must never get the same label as active.
  const activeLabelLine = src.match(/app\.bucket === "completed" \? "([^"]+)" : app\.bucket === "active" \? "([^"]+)"/);
  assert.ok(activeLabelLine, "action label must branch by bucket");
  assert.notEqual(activeLabelLine![1], activeLabelLine![2]);
});

test("Start New Package confirmation has the exact required title and message", () => {
  const src = readSrc(SCREEN);
  assert.match(src, />Start a New SBA Package\?</);
  assert.match(src, /Your existing application will remain available\./);
  assert.match(src, /completely separate and will/);
  assert.match(src, /not copy documents, ownership information, financial information/);
  assert.match(src, /questionnaire answers, or readiness/);
  assert.match(src, /progress\./);
});

test("confirmation buttons are 'Back to My Applications' and 'Create New Package'", () => {
  const src = readSrc(SCREEN);
  assert.match(src, /Back to My Applications/);
  assert.match(src, /Create New Package/);
});

// --- Flow: confirmation required, cancel returns to chooser ---

test("Start New Package button leads to the confirmation step, not directly to creation", () => {
  const src = readSrc(SCREEN);
  const buttonIdx = src.indexOf('onClick={() => setStep("confirmNew")}');
  assert.ok(buttonIdx > -1, "Start New Package must set step to confirmNew, not call submitChoice directly");
});

test("only 'Create New Package' calls the new-deal action; 'Back to My Applications' does not", () => {
  const src = readSrc(SCREEN);
  const backIdx = src.indexOf('onClick={() => setStep("choice")}');
  const createIdx = src.indexOf('onClick={() => void submitChoice({ action: "new" })}');
  assert.ok(backIdx > -1 && createIdx > -1);
  const between = src.slice(backIdx, backIdx + 100);
  assert.doesNotMatch(between, /submitChoice/, "Back button must not trigger any submission");
});

// --- Never auto-resume ---

test("no application card action fires automatically — every action is behind an explicit onClick", () => {
  const src = readSrc(SCREEN);
  assert.doesNotMatch(src, /useEffect\([^)]*submitChoice/);
});

test("no default/most-recent application is pre-selected in the list rendering", () => {
  const src = readSrc(SCREEN);
  assert.doesNotMatch(src, /\.sort\(/);
  assert.doesNotMatch(src, /defaultSelected|preselect|autoResume/i);
});

// --- Wiring into StartConciergeClient ---

test("StartConciergeClient renders the chooser only when applicationChoiceNeeded is signaled and no deal is chosen yet", () => {
  const src = readSrc(CLIENT);
  assert.match(src, /clientApplicationChoiceNeeded && !session\.dealId/);
});

test("resolving the chooser clears the choice-needed flag and sets the real session", () => {
  const src = readSrc(CLIENT);
  const onResolvedIdx = src.indexOf("onResolved={(dealId) => {");
  const block = src.slice(onResolvedIdx, onResolvedIdx + 200);
  assert.match(block, /setClientApplicationChoiceNeeded\(false\)/);
  assert.match(block, /setSession\(\{ dealId, name: session\.name/);
});

test("BorrowerWorkspaceGate passes applicationChoiceNeeded through to onVerified", () => {
  const src = readSrc(GATE);
  assert.match(src, /data\?\.applicationChoiceNeeded/);
  assert.match(src, /applicationChoiceNeeded: true/);
});

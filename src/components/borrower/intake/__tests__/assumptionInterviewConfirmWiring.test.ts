/**
 * SPEC-ASSUMPTION-CONFIRM-DEADEND-FIX-V1 — structural tripwire for
 * AssumptionInterview.tsx. This component has no interactive test harness
 * in this repo (no jsdom/testing-library precedent for "use client"
 * components with hooks — every other component test here is a
 * renderToStaticMarkup structural check, e.g. fixCardsPanelRender.test.ts),
 * so this proves the specific wiring the spec required, source-grep style,
 * same convention as businessPlanVerificationWiring.test.ts. The actual
 * end-to-end behavior (research fails → editing → confirm → bundle
 * trigger) is covered behaviorally in
 * src/app/api/borrower/portal/[token]/__tests__/assumptionConfirmDeadendFix.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSrc(): string {
  return readFileSync(
    resolve(process.cwd(), "src/components/borrower/intake/AssumptionInterview.tsx"),
    "utf8",
  );
}

test("TRIPWIRE: confirmAndContinue calls save() before the status:confirmed PATCH (fixes the no-ordering-guarantee bug)", () => {
  const src = readSrc();
  const fnIdx = src.indexOf("const confirmAndContinue = useCallback(async () => {");
  assert.ok(fnIdx > -1);
  const fnBody = src.slice(fnIdx, fnIdx + 1200);
  const saveIdx = fnBody.indexOf("await save();");
  const patchIdx = fnBody.indexOf('method: "PATCH"');
  assert.ok(saveIdx > -1, "confirmAndContinue must call save()");
  assert.ok(patchIdx > -1, "confirmAndContinue must PATCH status:confirmed");
  assert.ok(saveIdx < patchIdx, "save() must be awaited BEFORE the confirm PATCH fires");
});

test("TRIPWIRE: the editing phase's last sub-step renders a Confirm & continue button, not a dead end", () => {
  const src = readSrc();
  const editingIdx = src.indexOf("// ── Phase: editing (original 5-section form)");
  assert.ok(editingIdx > -1);
  const editingBody = src.slice(editingIdx);
  // canGoForward ? Next : Confirm-button — the ternary that replaces the
  // old unconditional-and-therefore-sometimes-nothing "canGoForward && <Next>".
  assert.match(editingBody, /canGoForward\s*\?\s*\(/, "must branch on canGoForward rather than only rendering Next when true and nothing otherwise");
  assert.match(editingBody, /onClick=\{confirmAndContinue\}/, "the non-canGoForward branch must call confirmAndContinue");
  assert.match(editingBody, /Confirm & continue/);
});

test("TRIPWIRE: a persistent 'confirm now' affordance exists even before the last sub-step", () => {
  const src = readSrc();
  const editingIdx = src.indexOf("// ── Phase: editing (original 5-section form)");
  const editingBody = src.slice(editingIdx);
  assert.match(editingBody, /Confirm now instead/);
});

test("TRIPWIRE: editing phase has a way back to presenting (previously one-way — 'I want to adjust' only went forward)", () => {
  const src = readSrc();
  const editingIdx = src.indexOf("// ── Phase: editing (original 5-section form)");
  const editingBody = src.slice(editingIdx, editingIdx + 1500);
  assert.match(editingBody, /setPhase\("presenting"\)/);
  assert.match(editingBody, /View research summary/);
});

test("TRIPWIRE: error and researchNote are rendered across all three phases (previously error only rendered in editing, researchNote didn't exist)", () => {
  const src = readSrc();
  const matches = src.match(/<ErrorAndNoteBanner error=\{error\} researchNote=\{researchNote\} \/>/g) ?? [];
  assert.equal(matches.length, 3, "expected one ErrorAndNoteBanner render per phase (researching, presenting, editing)");
});

test("TRIPWIRE: research-projections fetch failure/non-ok sets researchNote (previously fully silent, per the spec's Path 1)", () => {
  const src = readSrc();
  const initIdx = src.indexOf("async function init()");
  assert.ok(initIdx > -1);
  const initBody = src.slice(initIdx, initIdx + 2200);
  const setNoteCount = (initBody.match(/setResearchNote\(/g) ?? []).length;
  assert.ok(setNoteCount >= 2, "expected setResearchNote in both the non-ok branch and the catch branch of the research fetch");
});

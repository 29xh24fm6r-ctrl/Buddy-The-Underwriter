import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * SPEC-BORROWER-PROFILE-CONTINUE-AFTER-SAVE-1 regression guard.
 *
 * After save feedback (SPEC-BORROWER-PROFILE-SAVE-FEEDBACK-1) confirmed
 * persistence, the standalone /deals/[dealId]/borrower page still left the
 * banker stranded on a completed sub-task with no next step. These source-level
 * guards prove the shared ManagementProfilesForm now shows a "Return to Memo
 * Inputs" continue CTA after a successful save — but ONLY on the borrower page,
 * not in the embedded Memo Inputs section (context-aware, no redundant CTA).
 *
 * No auto-redirect: the CTA is a link the banker chooses, so they can still add
 * another sponsor/guarantor or keep editing.
 */

const root = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.resolve(root, rel), "utf8");
}

const FORM = "src/components/creditMemo/inputs/ManagementProfilesForm.tsx";
const BORROWER_PAGE = "src/app/(app)/deals/[dealId]/borrower/page.tsx";
const MEMO_INPUTS_BODY = "src/components/creditMemo/inputs/MemoInputsBody.tsx";

test("form accepts a returnToMemoInputsHref prop (context-aware CTA)", () => {
  const src = read(FORM);
  assert.ok(
    /returnToMemoInputsHref\?:\s*string/.test(src),
    "form must accept an optional returnToMemoInputsHref prop",
  );
});

test("CTA is gated on a successful save and the href being provided", () => {
  const src = read(FORM);
  // SPEC-BORROWER-PROFILE-CONTINUE-CTA-VISIBLE-1: gating is now per-row (the
  // row's own saved status), not a global savedOnce latch — see the dedicated
  // placement guard (borrowerProfileContinueCtaPlacement.test.ts) for layout.
  assert.ok(
    /statusByKey\[p\.id\]\?\.state\s*===\s*"saved"/.test(src),
    "CTA must render only for a row whose own status is saved",
  );
  assert.ok(
    /returnToMemoInputsHref\s*&&[\s\S]{0,80}statusByKey\[p\.id\]\?\.state\s*===\s*"saved"/.test(
      src,
    ),
    "CTA must require the href AND that row being saved",
  );
});

test("CTA is a Link to Memo Inputs, not an auto-redirect", () => {
  const src = read(FORM);
  assert.ok(
    /from "next\/link"/.test(src),
    "must use next/link for the continue CTA (navigation on click, not redirect)",
  );
  assert.ok(
    /href=\{returnToMemoInputsHref\}/.test(src),
    "CTA Link must point at the provided Memo Inputs href",
  );
  assert.ok(
    /Return to Memo Inputs/.test(src),
    "CTA must carry a clear 'Return to Memo Inputs' label",
  );
  // Guard against accidental auto-redirect being introduced.
  assert.ok(
    !/router\.(push|replace)\(|redirect\(/.test(src),
    "must NOT auto-redirect after save — banker may add another profile",
  );
});

test("standalone borrower page provides the CTA href", () => {
  const src = read(BORROWER_PAGE);
  assert.ok(
    /returnToMemoInputsHref=\{`\/deals\/\$\{dealId\}\/memo-inputs`\}/.test(src),
    "borrower page must pass the memo-inputs href so the continue CTA appears",
  );
});

test("embedded Memo Inputs section does NOT show a redundant CTA", () => {
  const src = read(MEMO_INPUTS_BODY);
  assert.ok(
    /ManagementProfilesForm/.test(src),
    "MemoInputsBody must render the shared form",
  );
  assert.ok(
    !/returnToMemoInputsHref/.test(src),
    "embedded Memo Inputs usage must omit returnToMemoInputsHref (no redundant return CTA)",
  );
});

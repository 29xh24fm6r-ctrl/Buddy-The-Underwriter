import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * SPEC-BORROWER-PROFILE-CONTINUE-CTA-PLACEMENT-1 regression guard.
 *
 * The continue CTA (SPEC-BORROWER-PROFILE-CONTINUE-AFTER-SAVE-1) was wired
 * correctly but rendered only at the bottom of the form, after the "Add new
 * profile" card — below the fold, so the banker saw "Saved at [time]" with no
 * visible next action. These guards prove the primary CTA now renders inline in
 * the SAME action row as the just-saved profile's status, while staying gated on
 * returnToMemoInputsHref so the embedded Memo Inputs usage never shows it.
 */

const root = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.resolve(root, rel), "utf8");
}

const FORM = "src/components/creditMemo/inputs/ManagementProfilesForm.tsx";

test("a shared ContinueCtaLink component exists", () => {
  const src = read(FORM);
  assert.ok(
    /function ContinueCtaLink\(/.test(src),
    "must extract a reusable ContinueCtaLink so inline + bottom CTAs share one impl",
  );
});

test("primary CTA renders inline for the just-saved profile row", () => {
  const src = read(FORM);
  // Inline CTA is gated on the per-row saved state, not just the global latch.
  assert.ok(
    /statusByKey\[p\.id\]\?\.state\s*===\s*"saved"/.test(src),
    "inline CTA must be gated on the row's own saved state",
  );
  assert.ok(
    /returnToMemoInputsHref\s*&&[\s\S]{0,80}statusByKey\[p\.id\]\?\.state\s*===\s*"saved"[\s\S]{0,60}<ContinueCtaLink/.test(
      src,
    ),
    "inline CTA must require the href AND the row being saved, then render ContinueCtaLink",
  );
});

test("inline CTA sits inside the profile rows, above the Add-new card", () => {
  const src = read(FORM);
  const firstInlineCta = src.indexOf("<ContinueCtaLink");
  const addNewCard = src.indexOf("Add new profile");
  assert.ok(firstInlineCta !== -1, "must render at least one ContinueCtaLink");
  assert.ok(addNewCard !== -1, "Add-new card must still exist");
  assert.ok(
    firstInlineCta < addNewCard,
    "the primary inline CTA must appear before the Add-new card in the layout",
  );
});

test("CTA stays gated on returnToMemoInputsHref (embedded Memo Inputs hides it)", () => {
  const src = read(FORM);
  // Every ContinueCtaLink usage is downstream of a returnToMemoInputsHref guard.
  const usages = src.split("<ContinueCtaLink").length - 1;
  assert.ok(usages >= 1, "must render ContinueCtaLink");
  const guardCount = (src.match(/returnToMemoInputsHref/g) ?? []).length;
  // prop type + destructure + inline guard + inline prop + bottom guard + bottom prop
  assert.ok(
    guardCount >= usages + 1,
    "each CTA usage must be paired with a returnToMemoInputsHref gate/prop",
  );
});

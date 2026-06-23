import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * BUG-BORROWER-PROFILE-STITCH-LIVE-1 regression guard.
 *
 * The borrower profile route used to render a Stitch iframe surface whose
 * export (`stitch_exports/borrower-profile/code.html`) was an empty 0-byte
 * placeholder, so the page showed:
 *
 *   "This page is wired, but the Stitch export in this folder was empty"
 *
 * The only mechanism that can surface that placeholder text on this page is the
 * StitchSurface / StitchRouteBridge embed loading the `borrower-profile` slug.
 * These guards prove the page is now a functional native surface that cannot
 * render the placeholder.
 */

const root = process.cwd();
const pagePath = path.resolve(
  root,
  "src/app/(app)/deals/[dealId]/borrower/page.tsx",
);

const placeholderPath = path.resolve(
  root,
  "stitch_exports/borrower-profile/code.html",
);

const PLACEHOLDER_MARKER =
  "the Stitch export in this folder was empty";

test("borrower profile page exists", () => {
  assert.ok(fs.existsSync(pagePath), `missing page: ${pagePath}`);
});

test("borrower profile page does not embed the Stitch surface (no placeholder path)", () => {
  const content = fs.readFileSync(pagePath, "utf8");
  // The placeholder is only reachable via the Stitch iframe embed. A native page
  // that never imports StitchSurface / StitchRouteBridge cannot render it.
  assert.ok(
    !content.includes("StitchSurface"),
    "borrower page must not render StitchSurface (would surface the empty export placeholder)",
  );
  assert.ok(
    !content.includes("StitchRouteBridge"),
    "borrower page must not render StitchRouteBridge",
  );
  assert.ok(
    !content.includes('surfaceKey="borrower_profile"'),
    "borrower page must not wire the borrower_profile Stitch surface",
  );
});

test("borrower profile page renders the functional native management form", () => {
  const content = fs.readFileSync(pagePath, "utf8");
  assert.ok(
    content.includes("ManagementProfilesForm"),
    "borrower page must render ManagementProfilesForm (the live borrower/sponsor/guarantor form)",
  );
  // Profiles must be loaded server-side so a refresh shows persisted state.
  assert.ok(
    content.includes("buildMemoInputPackage"),
    "borrower page must load persisted profiles via buildMemoInputPackage",
  );
});

test("borrower page source never contains the empty-export placeholder string", () => {
  const content = fs.readFileSync(pagePath, "utf8");
  assert.ok(
    !content.includes(PLACEHOLDER_MARKER),
    "borrower page source must not contain the empty Stitch export placeholder text",
  );
});

test("the borrower-profile placeholder export is no longer wired into a live page", () => {
  // We intentionally keep the placeholder file on disk for slug-coverage guards,
  // but it must remain unreferenced by the live borrower page. This documents
  // that the placeholder still exists yet can never reach a user.
  if (fs.existsSync(placeholderPath)) {
    const placeholder = fs.readFileSync(placeholderPath, "utf8");
    if (placeholder.includes(PLACEHOLDER_MARKER)) {
      const page = fs.readFileSync(pagePath, "utf8");
      assert.ok(
        !page.includes("StitchSurface") && !page.includes("StitchRouteBridge"),
        "borrower-profile export is still a placeholder — the page must not embed it",
      );
    }
  }
});

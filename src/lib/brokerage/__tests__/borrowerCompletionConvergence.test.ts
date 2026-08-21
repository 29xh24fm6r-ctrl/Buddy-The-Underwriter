import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../",
);

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("the shared /start borrower path authorizes an exact cookie-bound deal id", () => {
  const portalResolver = read("src/lib/borrower/resolvePortalContext.ts");
  const tridentResolver = read("src/lib/brokerage/trident/portalTokenAuth.ts");

  for (const source of [portalResolver, tridentResolver]) {
    assert.match(source, /getBorrowerSession/);
    assert.match(source, /session\?\.deal_id === token/);
  }
});

test("borrower SignWell buttons use the canonical filled-PDF form codes", () => {
  const panel = read("src/components/brokerage/SigningPanel.tsx");
  const renderer = read("src/lib/esign/signwell/resolveFilledPdfForSigning.ts");

  for (const code of ["FORM_1919", "FORM_413", "FORM_912", "FORM_4506C"]) {
    assert.match(panel, new RegExp(`code: [\"']${code}[\"']`));
    assert.match(renderer, new RegExp(`case [\"']${code}[\"']`));
  }
  assert.doesNotMatch(panel, /code: ["']SBA_1919["']/);
  assert.doesNotMatch(panel, /code: ["']IRS_4506C["']/);
});

test("post-submit completion reads canonical documents and Trident success", () => {
  const hub = read("src/app/api/borrower/portal/[token]/hub/route.ts");
  assert.match(hub, /\.from\("deal_documents"\)/);
  assert.match(hub, /status === "succeeded"/);
  assert.doesNotMatch(hub, /\.from\("documents"\)/);
});

test("borrower signing state survives refresh and prevents duplicate requests", () => {
  const route = read(
    "src/app/api/brokerage/deals/[dealId]/borrower-actions/[action]/route.ts",
  );
  const panel = read("src/components/brokerage/SigningPanel.tsx");

  assert.match(route, /signedDocuments/);
  assert.match(route, /pendingRequests/);
  assert.match(panel, /esign\.pendingRequests/);
  assert.match(panel, /esign\.signedDocuments/);
});

test("ownership intake persists named owners before advancing", () => {
  const panel = read("src/components/borrower/intake/IntakeOwnershipStep.tsx");
  const route = read("src/app/api/brokerage/concierge/route.ts");

  assert.match(panel, /action: "save_ownership"/);
  assert.match(panel, /if \(saved\) onContinue/);
  assert.match(route, /handleSaveOwnership/);
  assert.match(route, /propagateBorrowerFacts/);

  // The 100%-total rule used to be an inline `Math.abs(totalOwnership -
  // 100)` here. It now lives in summarizeOwnership, shared with the intake
  // form's live warning and the sealing gate, so all three agree on the
  // arithmetic instead of each re-deriving it. Same rule, one definition.
  assert.match(route, /summarizeOwnership/);
  assert.match(route, /ownershipSummary\.ok/);

  // The step must be able to EDIT and DELETE, not just create — a typo was
  // permanent before this, and deal b296dec2 sat at 149% with no
  // borrower-reachable way back.
  assert.match(panel, /action: "list_ownership"/);
  assert.match(panel, /action: "delete_owner"/);
  assert.match(route, /handleListOwnership/);
  assert.match(route, /handleDeleteOwner/);
  // Reconciliation is what makes a removal stick: fill-if-null propagation
  // can create an owner but can never correct or remove one.
  assert.match(route, /reconcileDealOwners/);
});

test("confirmed assumptions are revalidated before Trident generation", () => {
  const bootstrap = read("src/lib/sba/sbaAssumptionsBootstrap.ts");
  const confirmRoute = read(
    "src/app/api/borrower/portal/[token]/sba-assumptions/route.ts",
  );
  const sealStatus = read(
    "src/app/api/brokerage/deals/[dealId]/seal-status/route.ts",
  );
  const ensureSource = bootstrap.slice(
    bootstrap.indexOf("export async function ensureAssumptionsForPreview"),
    bootstrap.indexOf("export async function persistAssumptionsDraft"),
  );

  assert.doesNotMatch(
    ensureSource,
    /if \(existing && existing\.status === "confirmed"\) \{\s*return/s,
  );
  assert.match(confirmRoute, /validateSBAAssumptions\(candidate\)/);
  assert.match(confirmRoute, /assumption_validation_failed/);
  assert.match(sealStatus, /const ensured = await ensureAssumptionsForPreview/);
});

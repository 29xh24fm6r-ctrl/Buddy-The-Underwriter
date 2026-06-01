import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * SPEC-BORROWER-PROFILE-SAVE-FEEDBACK-1 regression guard.
 *
 * Save on the shared ManagementProfilesForm persisted to
 * deal_management_profiles, but the card showed no visible status, so the
 * banker could not tell whether Save worked. These source-level guards prove
 * the component now exposes a per-profile save/delete status machine and
 * renders Saving / Saved at [time] / failure feedback.
 *
 * The form is shared by both surfaces:
 *   - Memo Inputs → Management & Sponsors
 *   - Deal → Attach Borrower → Borrower & Sponsor Profile
 * so a single guard on the shared component covers both locations.
 */

const root = process.cwd();
const formPath = path.resolve(
  root,
  "src/components/creditMemo/inputs/ManagementProfilesForm.tsx",
);

function read(): string {
  return fs.readFileSync(formPath, "utf8");
}

test("ManagementProfilesForm source exists", () => {
  assert.ok(fs.existsSync(formPath), `missing form: ${formPath}`);
});

test("defines a per-profile save status state machine", () => {
  const src = read();
  for (const state of ["saving", "saved", "error", "removing"]) {
    assert.ok(
      src.includes(`"${state}"`),
      `save status must include the "${state}" state`,
    );
  }
  assert.ok(
    /statusByKey/.test(src),
    "status must be tracked per profile (keyed), not a single global flag",
  );
});

test("Save immediately shows Saving, then Saved at [time] on success", () => {
  const src = read();
  // Saving... appears before the success branch.
  assert.ok(
    /state:\s*"saving"/.test(src),
    "must set saving state when a save begins",
  );
  assert.ok(
    /Saving/.test(src),
    "must render a visible 'Saving' indicator",
  );
  // Saved branch stamps a local time captured in an event handler (no hydration risk).
  assert.ok(
    /state:\s*"saved",\s*at:\s*nowLocalTime\(\)/.test(src),
    "successful save must record state=saved with a local timestamp",
  );
  assert.ok(
    /Saved\{status\.at\s*\?\s*` at \$\{status\.at\}`/.test(src),
    "must render 'Saved at [time]' from the recorded timestamp",
  );
});

test("save failure surfaces a visible error message", () => {
  const src = read();
  assert.ok(
    /state:\s*"error",\s*message:\s*`Save failed: \$\{message\}`/.test(src),
    "save failures must record an error status with the failure message",
  );
  // Error branch renders the message in rose text.
  assert.ok(
    /text-rose-700/.test(src) && /status\.message/.test(src),
    "error status must render its message visibly",
  );
});

test("delete shows Removing and a Remove failed message on failure", () => {
  const src = read();
  assert.ok(/state:\s*"removing"/.test(src), "delete must show a removing state");
  assert.ok(/Removing/.test(src), "must render a visible 'Removing' indicator");
  assert.ok(
    /Remove failed: \$\{message\}/.test(src),
    "delete failure must surface a 'Remove failed' message",
  );
});

test("Save button is disabled while a save is in flight", () => {
  const src = read();
  assert.ok(
    /disabled=\{busy\}/.test(src),
    "Save button must be disabled while a save/delete is in flight",
  );
});

test("persistence path is unchanged (canonical memo-inputs endpoint)", () => {
  const src = read();
  assert.ok(
    src.includes("/api/deals/${dealId}/memo-inputs"),
    "must keep the canonical /api/deals/[dealId]/memo-inputs persistence path",
  );
});

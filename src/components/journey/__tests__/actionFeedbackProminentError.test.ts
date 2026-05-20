/**
 * SPEC-CTA-ERROR-VISIBILITY-1 — ActionFeedback prominent error variant
 *
 * The primary CTA error state must render as a visible block banner (not a
 * 11px chip) so bankers don't miss a failure. The recompute route returns
 * { error: "unauthorized" } on 403; the chip used to surface this as a
 * one-line easter egg next to a "Dismiss" link.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { humanizeActionError } from "../stageViews/_shared/ActionFeedback";

const SHARED = path.resolve(
  __dirname,
  "..",
  "stageViews",
  "_shared",
);
const ACTION_FEEDBACK_SRC = fs.readFileSync(
  path.resolve(SHARED, "ActionFeedback.tsx"),
  "utf-8",
);
const PRIMARY_ACTION_BAR_SRC = fs.readFileSync(
  path.resolve(SHARED, "PrimaryActionBar.tsx"),
  "utf-8",
);

describe("ActionFeedback prominent error variant", () => {
  it("ActionFeedback exposes a `prominent` prop", () => {
    assert.match(
      ACTION_FEEDBACK_SRC,
      /prominent\?:\s*boolean/,
      "ActionFeedbackProps must include `prominent?: boolean`",
    );
  });

  it("prominent + error renders a block banner with role=alert", () => {
    assert.match(
      ACTION_FEEDBACK_SRC,
      /prominent\s*&&\s*visibleStatus\s*===\s*"error"/,
      "must branch on prominent && error before the inline chip layout",
    );
    assert.match(
      ACTION_FEEDBACK_SRC,
      /data-prominent="true"/,
      "prominent banner must expose data-prominent for tests / styling",
    );
    assert.match(
      ACTION_FEEDBACK_SRC,
      /role="alert"[\s\S]*aria-live="assertive"/,
      "banner must be assertively announced to assistive tech",
    );
  });

  it("PrimaryActionBar opts into the prominent variant", () => {
    // Match across the JSX prop list — `prominent` self-closes after showRefreshedAt
    assert.match(
      PRIMARY_ACTION_BAR_SRC,
      /showRefreshedAt\s*\n\s*prominent/,
      "PrimaryActionBar must pass `prominent` to its ActionFeedback",
    );
  });

  it("StageBlockerList does NOT opt into prominent (per-row chips stay)", () => {
    const stageBlockerListSrc = fs.readFileSync(
      path.resolve(SHARED, "StageBlockerList.tsx"),
      "utf-8",
    );
    assert.ok(
      !stageBlockerListSrc.includes("prominent"),
      "per-blocker rows keep the compact chip — prominent banner is reserved for the primary CTA",
    );
  });

  it("humanizeActionError converts 'unauthorized' into a banker-actionable line", () => {
    assert.equal(
      humanizeActionError("unauthorized"),
      "Session expired — sign out and sign back in.",
    );
    assert.equal(
      humanizeActionError("HTTP 403"),
      "Session expired — sign out and sign back in.",
    );
    assert.equal(
      humanizeActionError("HTTP 401"),
      "Session expired — sign out and sign back in.",
    );
    assert.equal(
      humanizeActionError("tenant_mismatch"),
      "Session expired — sign out and sign back in.",
    );
  });

  it("humanizeActionError handles 5xx + fetch failures with a retry prompt", () => {
    assert.equal(
      humanizeActionError("HTTP 500"),
      "Server hit an unexpected error. Try again in a moment.",
    );
    assert.equal(
      humanizeActionError("fetch_failed"),
      "Server hit an unexpected error. Try again in a moment.",
    );
    assert.equal(
      humanizeActionError("unexpected_error"),
      "Server hit an unexpected error. Try again in a moment.",
    );
  });

  it("humanizeActionError passes through unknown messages verbatim", () => {
    assert.equal(
      humanizeActionError("SPREADS_IN_PROGRESS"),
      "SPREADS_IN_PROGRESS",
    );
    assert.equal(
      humanizeActionError(null),
      "Something went wrong. Try again.",
    );
    assert.equal(
      humanizeActionError(""),
      "Something went wrong. Try again.",
    );
  });
});

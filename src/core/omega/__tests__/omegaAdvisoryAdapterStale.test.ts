import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Source-grep guards for OmegaAdvisoryAdapter's rev 3.3 stale-reason invariant.
// The adapter imports "server-only", so runtime behaviour tests aren't practical
// without extracting a pure helper. These grep-level guards are enough to prevent
// regression of the specific signal rev 3.3 adds.

const ADAPTER_PATH = path.resolve(__dirname, "../OmegaAdvisoryAdapter.ts");
const ADAPTER = fs.readFileSync(ADAPTER_PATH, "utf-8");

describe("OmegaAdvisoryAdapter — rev 3.3 kill-switch signal surfacing", () => {
  it("detects pulse_advisory_tools_not_yet_available in sub-results", () => {
    assert.ok(
      ADAPTER.includes("pulse_advisory_tools_not_yet_available"),
      "adapter must distinguish the kill-switched read error",
    );
  });

  it("sets 'Deal-scoped advisory tools not yet available in Pulse' when the kill-switch fires", () => {
    assert.ok(
      ADAPTER.includes(
        "Deal-scoped advisory tools not yet available in Pulse",
      ),
      "adapter must surface the explicit stale reason for the kill-switched path",
    );
  });

  it("retains the generic 'no data for this deal' fallback for other failures", () => {
    assert.ok(
      ADAPTER.includes("Omega returned no data for this deal"),
      "adapter must keep the existing generic stale reason as fallback",
    );
  });

  it("preserves the OmegaAdvisoryState contract — never throws, returns stale on failure", () => {
    // Existing invariants from the adapter's design
    assert.ok(
      ADAPTER.includes("stale:"),
      "adapter must return OmegaAdvisoryState with stale field",
    );
    assert.ok(
      ADAPTER.includes("Promise.allSettled"),
      "adapter must use Promise.allSettled to tolerate individual sub-call failures",
    );
  });
});

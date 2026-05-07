// SPEC-13.5 PR-B B-3 (R1) — pure helper tests for routePartition.
//
// Pins the routing contract so future devs can't accidentally re-route
// a UI-state field to canonical (which would re-introduce the legacy /
// canonical split SPEC-13.5 exists to eliminate) or vice versa.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  routePartition,
  flattenCanonicalForFromWizard,
  hasAnyCanonicalField,
  hasAnyUIStateField,
} from "../routePartition";

// ── Canonical routing ──────────────────────────────────────────────────

test("[routePartition-1] business_description routes to canonical", () => {
  const r = routePartition({ business_description: "An LLC operating a yacht service" });
  assert.equal(r.canonical.business_description, "An LLC operating a yacht service");
  assert.equal(Object.keys(r.uiState).length, 0);
});

test("[routePartition-2] revenue_mix routes to canonical (legacy key, dispatcher maps to revenue_model)", () => {
  const r = routePartition({ revenue_mix: "Recurring SaaS + perpetual licenses" });
  assert.equal(r.canonical.revenue_mix, "Recurring SaaS + perpetual licenses");
  assert.equal(Object.keys(r.uiState).length, 0);
});

test("[routePartition-3] seasonality routes to canonical", () => {
  const r = routePartition({ seasonality: "Q4 spike" });
  assert.equal(r.canonical.seasonality, "Q4 spike");
});

test("[routePartition-4] principal_bio_<uuid> keys collapse into principal_bios sub-record", () => {
  const r = routePartition({
    "principal_bio_aaa-111": "Joe Smith bio",
    "principal_bio_bbb-222": "Jane Doe bio",
  });
  assert.deepEqual(r.canonical.principal_bios, {
    "aaa-111": "Joe Smith bio",
    "bbb-222": "Jane Doe bio",
  });
  assert.equal(Object.keys(r.uiState).length, 0);
});

test("[routePartition-5] principal_bio with non-string value is dropped (not added)", () => {
  const r = routePartition({
    "principal_bio_aaa-111": null,
    "principal_bio_bbb-222": 42,
    "principal_bio_ccc-333": "valid string",
  });
  // Only the string-valued entry should appear.
  assert.deepEqual(r.canonical.principal_bios, {
    "ccc-333": "valid string",
  });
});

// ── UI-state routing ───────────────────────────────────────────────────

test("[routePartition-6] tabs_viewed routes to uiState", () => {
  const r = routePartition({ tabs_viewed: ["profile", "qualitative"] });
  assert.deepEqual(r.uiState.tabs_viewed, ["profile", "qualitative"]);
  assert.equal(Object.keys(r.canonical).length, 0);
});

test("[routePartition-7] all 5 qualitative_override_* keys route to uiState", () => {
  const r = routePartition({
    qualitative_override_character: { score: 4, reason: "strong" },
    qualitative_override_capital: { score: 3, reason: "thin" },
    qualitative_override_conditions: { score: 4, reason: "ok" },
    qualitative_override_management: { score: 5, reason: "deep bench" },
    qualitative_override_business_model: { score: 4, reason: "recurring" },
  });
  assert.equal(Object.keys(r.canonical).length, 0);
  assert.ok((r.uiState as any).qualitative_override_character);
  assert.ok((r.uiState as any).qualitative_override_capital);
  assert.ok((r.uiState as any).qualitative_override_conditions);
  assert.ok((r.uiState as any).qualitative_override_management);
  assert.ok((r.uiState as any).qualitative_override_business_model);
});

test("[routePartition-8] covenant_banker_notes + covenant_adjustments route to uiState", () => {
  const r = routePartition({
    covenant_banker_notes: "Quarterly DSCR test",
    covenant_adjustments: [{ covenantId: "c1", action: "modify", note: "loosen" }],
  });
  assert.equal(r.uiState.covenant_banker_notes, "Quarterly DSCR test");
  assert.ok(Array.isArray(r.uiState.covenant_adjustments));
});

test("[routePartition-9] committee_ready + committee_reviewed_at route to uiState", () => {
  const r = routePartition({
    committee_ready: true,
    committee_reviewed_at: "2026-05-07T12:00:00Z",
  });
  assert.equal(r.uiState.committee_ready, true);
  assert.equal(r.uiState.committee_reviewed_at, "2026-05-07T12:00:00Z");
});

// ── Default for unknown keys ───────────────────────────────────────────

test("[routePartition-10] unknown keys default to uiState (Option A: dropped at the shim)", () => {
  const r = routePartition({
    competitive_advantages: "Superior service",
    banker_summary: "First-rate operator",
    some_future_key: "value",
  });
  // None of these are in CANONICAL_KEYS, so they fall through to uiState.
  // The shim no-ops, so they don't persist. This is intentional per
  // Option A — adding an unknown key to canonical would silently write
  // it into a store it doesn't belong in.
  assert.equal(Object.keys(r.canonical).length, 0);
  assert.equal((r.uiState as any).competitive_advantages, "Superior service");
  assert.equal((r.uiState as any).banker_summary, "First-rate operator");
  assert.equal((r.uiState as any).some_future_key, "value");
});

// ── Mixed patches ──────────────────────────────────────────────────────

test("[routePartition-11] mixed canonical + UI-state patch splits cleanly", () => {
  const r = routePartition({
    business_description: "yacht ops",
    "principal_bio_owner-1": "10 years experience",
    tabs_viewed: ["profile"],
    qualitative_override_character: { score: 4, reason: "strong" },
  });
  assert.equal(r.canonical.business_description, "yacht ops");
  assert.deepEqual(r.canonical.principal_bios, { "owner-1": "10 years experience" });
  assert.deepEqual(r.uiState.tabs_viewed, ["profile"]);
  assert.ok((r.uiState as any).qualitative_override_character);
});

test("[routePartition-12] empty patch produces empty results", () => {
  const r = routePartition({});
  assert.equal(Object.keys(r.canonical).length, 0);
  assert.equal(Object.keys(r.uiState).length, 0);
  assert.equal(hasAnyCanonicalField(r.canonical), false);
  assert.equal(hasAnyUIStateField(r.uiState), false);
});

// ── Helper functions ───────────────────────────────────────────────────

test("[routePartition-13] hasAnyCanonicalField returns false for empty principal_bios", () => {
  // An empty principal_bios sub-record should not count as "has canonical."
  assert.equal(hasAnyCanonicalField({ principal_bios: {} }), false);
  assert.equal(hasAnyCanonicalField({}), false);
  // But any populated field does count.
  assert.equal(hasAnyCanonicalField({ business_description: "x" }), true);
  assert.equal(hasAnyCanonicalField({ revenue_mix: "y" }), true);
  assert.equal(hasAnyCanonicalField({ seasonality: "z" }), true);
  assert.equal(
    hasAnyCanonicalField({ principal_bios: { "a": "bio" } }),
    true,
  );
});

test("[routePartition-14] flattenCanonicalForFromWizard converts principal_bios back to principal_bio_<uuid> keys", () => {
  const flat = flattenCanonicalForFromWizard({
    business_description: "yacht ops",
    revenue_mix: "charters",
    seasonality: "Q3 peak",
    principal_bios: {
      "owner-1": "10 years experience",
      "owner-2": "MBA + sea time",
    },
  });
  assert.equal(flat.business_description, "yacht ops");
  assert.equal(flat.revenue_mix, "charters");
  assert.equal(flat.seasonality, "Q3 peak");
  assert.equal(flat["principal_bio_owner-1"], "10 years experience");
  assert.equal(flat["principal_bio_owner-2"], "MBA + sea time");
  // No principal_bios sub-record in the flat output.
  assert.equal((flat as any).principal_bios, undefined);
});

test("[routePartition-15] flattenCanonicalForFromWizard preserves null values (explicit clear)", () => {
  const flat = flattenCanonicalForFromWizard({
    business_description: null,
    revenue_mix: "charters",
  });
  // null is preserved so the wizard can explicitly clear a field.
  assert.equal(flat.business_description, null);
  assert.equal(flat.revenue_mix, "charters");
});

// ── Routing-contract invariants ────────────────────────────────────────

test("[routePartition-16] the same input never writes to BOTH stores for the same field", () => {
  // Invariant: every key in the input goes to exactly one of canonical
  // or uiState. No double-write. (Principal_bio_* keys collapse into
  // canonical.principal_bios, so they appear in canonical only.)
  const inputKeys = [
    "business_description",
    "revenue_mix",
    "seasonality",
    "principal_bio_aaa",
    "tabs_viewed",
    "committee_ready",
    "covenant_banker_notes",
    "qualitative_override_character",
    "unknown_key",
  ];
  const patch: Record<string, unknown> = {};
  for (const k of inputKeys) {
    patch[k] = k.startsWith("principal_bio_") ? "bio" : "value";
  }
  const r = routePartition(patch);
  // Walk every input key and assert it appears in EXACTLY ONE of the
  // two outputs (or, for principal_bio_*, in canonical.principal_bios).
  for (const k of inputKeys) {
    if (k.startsWith("principal_bio_")) {
      const ownerId = k.slice("principal_bio_".length);
      assert.ok(
        r.canonical.principal_bios?.[ownerId] !== undefined,
        `${k} should appear in canonical.principal_bios`,
      );
      assert.ok(
        !((k as string) in (r.uiState as Record<string, unknown>)),
        `${k} must NOT appear in uiState`,
      );
    } else {
      const inCanonical = (k as string) in (r.canonical as Record<string, unknown>);
      const inUI = (k as string) in (r.uiState as Record<string, unknown>);
      assert.equal(
        Number(inCanonical) + Number(inUI),
        1,
        `${k} must appear in exactly one of canonical or uiState (got canonical=${inCanonical}, uiState=${inUI})`,
      );
    }
  }
});

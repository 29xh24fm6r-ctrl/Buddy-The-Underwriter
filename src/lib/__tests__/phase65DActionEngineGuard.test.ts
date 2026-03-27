import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// ── Guard 1: Action engine modules exist ──────────────────
test("action engine modules exist", () => {
  const files = [
    "src/core/actions/types.ts",
    "src/core/actions/actionCatalog.ts",
    "src/core/actions/blockerActionMap.ts",
    "src/core/actions/deriveNextActions.ts",
    "src/core/actions/derivePrimaryAction.ts",
  ];
  for (const f of files) {
    assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  }
});

// ── Guard 2: Action catalog covers all action codes ───────
test("action catalog has entries for all BuddyActionCode values", () => {
  const typesContent = fs.readFileSync(path.resolve(root, "src/core/actions/types.ts"), "utf8");
  const catalogContent = fs.readFileSync(path.resolve(root, "src/core/actions/actionCatalog.ts"), "utf8");

  // Extract action codes from BuddyActionCode type only (between its definition and the next export)
  const actionCodeBlock = typesContent.match(/export type BuddyActionCode\s*=([\s\S]*?);/)?.[1] ?? "";
  const codeMatches = actionCodeBlock.match(/"\w+"/g) ?? [];
  const codes = codeMatches.map((m) => m.replace(/"/g, ""));

  for (const code of codes) {
    assert.ok(
      catalogContent.includes(`${code}:`),
      `Action catalog missing entry for code: ${code}`,
    );
  }
});

// ── Guard 3: Blocker map uses real blocker codes ──────────
test("blocker action map uses real LifecycleBlockerCode values", () => {
  const modelContent = fs.readFileSync(path.resolve(root, "src/buddy/lifecycle/model.ts"), "utf8");
  const mapContent = fs.readFileSync(path.resolve(root, "src/core/actions/blockerActionMap.ts"), "utf8");

  // Extract keys from the map
  const mapKeys = (mapContent.match(/^\s+(\w+):/gm) ?? []).map((m) => m.trim().replace(":", ""));

  for (const key of mapKeys) {
    assert.ok(
      modelContent.includes(`"${key}"`),
      `Blocker map key "${key}" not found in LifecycleBlockerCode`,
    );
  }
});

// ── Guard 4: deriveNextActions has no Omega dependency ────
test("deriveNextActions has no Omega dependency", () => {
  const content = fs.readFileSync(path.resolve(root, "src/core/actions/deriveNextActions.ts"), "utf8");
  assert.ok(!content.includes("from \"@/core/omega"), "Must not import from omega/");
  assert.ok(!content.includes("OmegaAdvisory"), "Must not reference OmegaAdvisory");
});

// ── Guard 5: State API returns nextActions and primaryAction ──
test("state API returns nextActions and primaryAction", () => {
  const content = fs.readFileSync(path.resolve(root, "src/app/api/deals/[dealId]/state/route.ts"), "utf8");
  assert.ok(content.includes("deriveNextActions"), "Must call deriveNextActions");
  assert.ok(content.includes("nextActions"), "Must return nextActions");
  assert.ok(content.includes("primaryAction"), "Must return primaryAction");
});

// ── Guard 6: Canonical state injection includes actions ───
test("canonical state injection renders actions panel", () => {
  const content = fs.readFileSync(path.resolve(root, "src/lib/stitch/activations/canonicalStateInjection.ts"), "utf8");
  assert.ok(content.includes("deriveNextActions"), "Must call deriveNextActions");
  assert.ok(content.includes("data-buddy-actions"), "Must render actions DOM marker");
  assert.ok(content.includes("data-primary-action"), "Must render primary action marker");
});

// ── Guard 7: StitchRouteBridge passes actions in data ─────
test("StitchRouteBridge merges nextActions into activation data", () => {
  const content = fs.readFileSync(path.resolve(root, "src/components/stitch/StitchRouteBridge.tsx"), "utf8");
  assert.ok(content.includes("existingData.nextActions"), "Must merge nextActions");
  assert.ok(content.includes("existingData.primaryAction"), "Must merge primaryAction");
});

// ── Guard 8: DealNextActionsPanel exists ──────────────────
test("DealNextActionsPanel component exists", () => {
  const filePath = path.resolve(root, "src/components/deal/DealNextActionsPanel.tsx");
  assert.ok(fs.existsSync(filePath), "Missing: DealNextActionsPanel.tsx");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("data-buddy-actions"), "Must have actions DOM marker");
  assert.ok(content.includes("data-primary-action"), "Must have primary action marker");
  assert.ok(content.includes("BuddyNextAction"), "Must use BuddyNextAction type");
});

// ── Guard 9: Every action has source: canonical ───────────
test("every action in catalog has source canonical", () => {
  const content = fs.readFileSync(path.resolve(root, "src/core/actions/actionCatalog.ts"), "utf8");
  const sourceMatches = content.match(/source: "(\w+)"/g) ?? [];
  for (const m of sourceMatches) {
    assert.ok(m.includes('"canonical"'), `Action has non-canonical source: ${m}`);
  }
});

// ── Guard 10: DOM marker order is correct ─────────────────
test("DOM markers follow canonical ordering: state > explanation > actions > advisory", () => {
  const content = fs.readFileSync(path.resolve(root, "src/lib/stitch/activations/canonicalStateInjection.ts"), "utf8");
  const statePos = content.indexOf("data-canonical-state");
  const explPos = content.indexOf("data-buddy-explanation");
  const actionsPos = content.indexOf("data-buddy-actions");
  const advisoryPos = content.indexOf("data-omega-advisory");

  assert.ok(statePos < explPos, "State bar must come before explanation");
  assert.ok(explPos < actionsPos, "Explanation must come before actions");
  assert.ok(actionsPos < advisoryPos, "Actions must come before advisory");
});

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Page-level tests for /admin/brokerage-owner
 *
 * Validates structural properties of the route and its components
 * without requiring a full React render environment.
 *
 * Spec: 16B / Spec 18 — Owner/Admin Command Center Route Integration
 */

const ROOT = path.resolve(__dirname, "..");
const SRC_ROOT = path.resolve(__dirname, "../../../../..");

// ---------------------------------------------------------------------------
// Guard 1: Page file exists and exports a default function
// ---------------------------------------------------------------------------

test("/admin/brokerage-owner page.tsx exists", () => {
  const pagePath = path.join(ROOT, "page.tsx");
  assert.ok(fs.existsSync(pagePath), "page.tsx should exist at admin/brokerage-owner/");
});

// ---------------------------------------------------------------------------
// Guard 2: Shell component exists
// ---------------------------------------------------------------------------

test("BrokerageOwnerCommandCenterShell.tsx exists", () => {
  const shellPath = path.join(ROOT, "BrokerageOwnerCommandCenterShell.tsx");
  assert.ok(fs.existsSync(shellPath), "Shell component should exist");
});

// ---------------------------------------------------------------------------
// Guard 3: Empty state renders honest message (no fake/demo data)
// ---------------------------------------------------------------------------

test("shell component contains honest empty state message", () => {
  const shellPath = path.join(ROOT, "BrokerageOwnerCommandCenterShell.tsx");
  const src = fs.readFileSync(shellPath, "utf-8");
  assert.ok(
    src.includes("Brokerage operating data will appear here"),
    "Empty state should show honest operational message",
  );
});

// ---------------------------------------------------------------------------
// Guard 4: Dark theme tokens present
// ---------------------------------------------------------------------------

test("shell uses dark theme tokens", () => {
  const shellPath = path.join(ROOT, "BrokerageOwnerCommandCenterShell.tsx");
  const src = fs.readFileSync(shellPath, "utf-8");
  assert.ok(src.includes("text-white"), "Should use dark theme text-white");
  assert.ok(
    src.includes("text-white/") || src.includes("text-white/50") || src.includes("text-white/60"),
    "Should use white opacity tokens",
  );
});

// ---------------------------------------------------------------------------
// Guard 5: No fake or demo data in shell component
// ---------------------------------------------------------------------------

test("no demo/seed/fake data in shell component", () => {
  const shellPath = path.join(ROOT, "BrokerageOwnerCommandCenterShell.tsx");
  const src = fs.readFileSync(shellPath, "utf-8").toLowerCase();

  const forbidden = ["demo", "seed", "mock", "fake", "sample", "placeholder"];
  for (const word of forbidden) {
    assert.ok(
      !src.includes(word),
      `Shell should not contain "${word}" — found in source`,
    );
  }
});

// ---------------------------------------------------------------------------
// Guard 6: No approval/funding language in shell
// ---------------------------------------------------------------------------

test("no approval or funding language in shell", () => {
  const shellPath = path.join(ROOT, "BrokerageOwnerCommandCenterShell.tsx");
  const src = fs.readFileSync(shellPath, "utf-8").toLowerCase();

  const forbidden = ["approved", "approval", "funded", "funding", "declined"];
  for (const word of forbidden) {
    assert.ok(
      !src.includes(word),
      `Shell should not contain "${word}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// Guard 7: No credit memo imports
// ---------------------------------------------------------------------------

test("page does not import credit memo modules", () => {
  const pagePath = path.join(ROOT, "page.tsx");
  const src = fs.readFileSync(pagePath, "utf-8");
  assert.ok(
    !src.includes("creditMemo") && !src.includes("credit-memo") && !src.includes("CreditMemo"),
    "Page should not import any credit memo modules",
  );
});

test("shell does not import credit memo modules", () => {
  const shellPath = path.join(ROOT, "BrokerageOwnerCommandCenterShell.tsx");
  const src = fs.readFileSync(shellPath, "utf-8");
  assert.ok(
    !src.includes("creditMemo") && !src.includes("credit-memo") && !src.includes("CreditMemo"),
    "Shell should not import any credit memo modules",
  );
});

// ---------------------------------------------------------------------------
// Guard 8: Page uses server-only and force-dynamic
// ---------------------------------------------------------------------------

test("page has server-only import and force-dynamic export", () => {
  const pagePath = path.join(ROOT, "page.tsx");
  const src = fs.readFileSync(pagePath, "utf-8");
  assert.ok(src.includes('"server-only"'), "Page should import server-only");
  assert.ok(src.includes('force-dynamic'), "Page should export dynamic = force-dynamic");
});

// ---------------------------------------------------------------------------
// Guard 9: Shell is a client component
// ---------------------------------------------------------------------------

test("shell has 'use client' directive", () => {
  const shellPath = path.join(ROOT, "BrokerageOwnerCommandCenterShell.tsx");
  const src = fs.readFileSync(shellPath, "utf-8");
  assert.ok(src.trimStart().startsWith('"use client"'), "Shell must be a client component");
});

// ---------------------------------------------------------------------------
// Guard 10: API route exists
// ---------------------------------------------------------------------------

test("API route for brokerage-owner exists", () => {
  const apiPath = path.join(SRC_ROOT, "app/api/admin/brokerage-owner/route.ts");
  assert.ok(fs.existsSync(apiPath), "API route should exist at api/admin/brokerage-owner/");
});

// ---------------------------------------------------------------------------
// Guard 11: Operational state adapter exists
// ---------------------------------------------------------------------------

test("operational state adapter module exists", () => {
  const adapterPath = path.join(
    SRC_ROOT,
    "lib/admin/buildBrokerageOwnerCommandCenterFromOperationalState.ts",
  );
  assert.ok(fs.existsSync(adapterPath), "Adapter should exist");
});

// ---------------------------------------------------------------------------
// Guard 12: Adapter does not contain fake/demo data
// ---------------------------------------------------------------------------

test("adapter does not contain demo seed data", () => {
  const adapterPath = path.join(
    SRC_ROOT,
    "lib/admin/buildBrokerageOwnerCommandCenterFromOperationalState.ts",
  );
  const src = fs.readFileSync(adapterPath, "utf-8").toLowerCase();
  const forbidden = ["demo", "seed", "fake", "sample", "mock"];
  for (const word of forbidden) {
    assert.ok(
      !src.includes(word),
      `Adapter should not contain "${word}"`,
    );
  }
});

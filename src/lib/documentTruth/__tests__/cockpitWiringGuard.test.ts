import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const PANELS_DIR = path.resolve(
  __dirname,
  "../../../components/deals/cockpit/panels",
);
const HOOKS_DIR = path.resolve(__dirname, "../../../hooks");

// ─── Status chip vocabulary enforcement ───────────────────────────────────────

describe("Core Documents panel — status chip vocabulary", () => {
  it("does not use 'Validated' as a renderable chip value", () => {
    const content = fs.readFileSync(
      path.join(PANELS_DIR, "CanonicalCoreDocumentsPanel.tsx"),
      "utf-8",
    );
    // StatusChip type must not include Validated
    const typeBlock = content.match(/type StatusChip[\s\S]*?;/);
    if (typeBlock) {
      assert.ok(
        !typeBlock[0].includes('"Validated"'),
        "StatusChip type must not include Validated",
      );
    }
    // CHIP_STYLES must not have Validated key
    assert.ok(
      !content.includes('Validated:'),
      "CHIP_STYLES must not have a Validated entry",
    );
  });

  it("uses approved chip vocabulary only", () => {
    const content = fs.readFileSync(
      path.join(PANELS_DIR, "CanonicalCoreDocumentsPanel.tsx"),
      "utf-8",
    );
    const approved = [
      "Uploaded",
      "Classified",
      "Matched",
      "Review Required",
      "Confirmed",
      "Satisfied",
      "Waived",
      "Unmatched",
      "Rejected",
      "Missing",
    ];
    for (const chip of approved) {
      assert.ok(
        content.includes(`"${chip}"`),
        `Must include approved chip: ${chip}`,
      );
    }
  });
});

// ─── No independent data fetching ─────────────────────────────────────────────

describe("Canonical panels — no independent fetching", () => {
  const CANONICAL_PANELS = [
    "CanonicalCoreDocumentsPanel.tsx",
    "CanonicalChecklistPanel.tsx",
    "CanonicalReadinessPanel.tsx",
  ];

  for (const panel of CANONICAL_PANELS) {
    it(`${panel} does not use fetch()`, () => {
      const content = fs.readFileSync(path.join(PANELS_DIR, panel), "utf-8");
      const lines = content
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"));
      assert.ok(
        !lines.join("\n").match(/\bfetch\s*\(/),
        `${panel} must not call fetch() — use useCockpitStateContext()`,
      );
    });

    it(`${panel} uses useCockpitStateContext`, () => {
      const content = fs.readFileSync(path.join(PANELS_DIR, panel), "utf-8");
      assert.ok(
        content.includes("useCockpitStateContext"),
        `${panel} must use useCockpitStateContext hook`,
      );
    });
  }
});

// ─── Header identity enforcement ──────────────────────────────────────────────

describe("CockpitCanonicalHeader", () => {
  const headerPath = path.resolve(
    __dirname,
    "../../../components/deals/cockpit/CockpitCanonicalHeader.tsx",
  );

  it("does not render 'Borrower not set' as a UI label", () => {
    const content = fs.readFileSync(headerPath, "utf-8");
    // Filter out comments — only check JSX/render lines
    const jsxLines = content.split("\n").filter(
      (l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/**"),
    );
    assert.ok(
      !jsxLines.join("\n").includes("Borrower not set"),
      "Header must not render 'Borrower not set' as a UI label",
    );
  });

  it("does not render 'NEEDS NAME'", () => {
    const content = fs.readFileSync(headerPath, "utf-8");
    assert.ok(
      !content.includes("NEEDS NAME"),
      "Header must not render 'NEEDS NAME'",
    );
  });

  it("uses useCockpitStateContext", () => {
    const content = fs.readFileSync(headerPath, "utf-8");
    assert.ok(
      content.includes("useCockpitStateContext"),
      "Header must use canonical state hook",
    );
  });

  it("shows hard error on missing borrower", () => {
    const content = fs.readFileSync(headerPath, "utf-8");
    assert.ok(
      content.includes("Borrower data unavailable"),
      "Header must show hard error when borrower missing",
    );
  });
});

// ─── useCockpitState hook ─────────────────────────────────────────────────────

describe("useCockpitState hook", () => {
  it("exists and exports hook + provider + context", () => {
    const content = fs.readFileSync(
      path.join(HOOKS_DIR, "useCockpitState.tsx"),
      "utf-8",
    );
    assert.ok(content.includes("export function useCockpitState"));
    assert.ok(content.includes("export function CockpitStateProvider"));
    assert.ok(content.includes("export function useCockpitStateContext"));
  });

  it("fetches from /api/deals/[dealId]/cockpit-state only", () => {
    const content = fs.readFileSync(
      path.join(HOOKS_DIR, "useCockpitState.tsx"),
      "utf-8",
    );
    assert.ok(content.includes("cockpit-state"));
    // Should not fetch from other deal endpoints directly
    assert.ok(!content.includes("/api/deals/${dealId}/slots"));
    assert.ok(!content.includes("/api/deals/${dealId}/checklist"));
  });

  it("exposes refetch for recompute after document actions", () => {
    const content = fs.readFileSync(
      path.join(HOOKS_DIR, "useCockpitState.tsx"),
      "utf-8",
    );
    assert.ok(content.includes("refetch"));
  });
});

// ─── Blocker copy rules ──────────────────────────────────────────────────────

describe("Readiness panel — blocker copy", () => {
  it("does not use banned vague copy", () => {
    const content = fs.readFileSync(
      path.join(PANELS_DIR, "CanonicalReadinessPanel.tsx"),
      "utf-8",
    );
    // These are banned in the spec
    assert.ok(!content.includes('"Documents missing"'));
    assert.ok(!content.includes('"Not ready"'));
    assert.ok(!content.includes('"Validation incomplete"'));
    assert.ok(
      !content.includes("Documents must be reviewed and confirmed"),
    );
  });
});

// ─── Checklist count rule ────────────────────────────────────────────────────

describe("Checklist panel — count rule", () => {
  it("counts satisfied only (not received)", () => {
    const content = fs.readFileSync(
      path.join(PANELS_DIR, "CanonicalChecklistPanel.tsx"),
      "utf-8",
    );
    // Must filter on satisfied/waived, not just received
    assert.ok(
      content.includes('"satisfied"') && content.includes('"waived"'),
      "Checklist must count satisfied + waived as the numerator",
    );
    assert.ok(
      content.includes("required satisfied"),
      "Checklist header must say 'required satisfied'",
    );
  });
});


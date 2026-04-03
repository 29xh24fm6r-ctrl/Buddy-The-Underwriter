import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const COMPONENTS_DIR = path.resolve(__dirname, "../../../components/underwrite");
const BUILDER_PATH = path.resolve(__dirname, "../buildTrustLayer.ts");
const WORKBENCH_PATH = path.join(COMPONENTS_DIR, "AnalystWorkbench.tsx");
const TRUST_LAYER_PATH = path.join(COMPONENTS_DIR, "UnderwriteTrustLayer.tsx");
const MEMO_CARD_PATH = path.join(COMPONENTS_DIR, "MemoFreshnessCard.tsx");
const PACKET_CARD_PATH = path.join(COMPONENTS_DIR, "PacketReadinessCard.tsx");
const FIN_CARD_PATH = path.join(COMPONENTS_DIR, "FinancialValidationCard.tsx");
const STATE_ROUTE_PATH = path.resolve(__dirname, "../../../app/api/deals/[dealId]/underwrite/state/route.ts");

// ── 1. Trust layer components exist ──────────────────────────────────────────

describe("Trust layer component files exist", () => {
  const REQUIRED = [
    "UnderwriteTrustLayer.tsx",
    "MemoFreshnessCard.tsx",
    "PacketReadinessCard.tsx",
    "FinancialValidationCard.tsx",
  ];

  for (const f of REQUIRED) {
    it(`${f} exists`, () => {
      assert.ok(fs.existsSync(path.join(COMPONENTS_DIR, f)), `${f} must exist`);
    });
  }
});

// ── 2. Builder exists and is server-only ────────────────────────────────────

describe("Trust layer builder", () => {
  it("buildTrustLayer.ts exists", () => {
    assert.ok(fs.existsSync(BUILDER_PATH));
  });

  it("is server-only", () => {
    const content = fs.readFileSync(BUILDER_PATH, "utf-8");
    assert.ok(content.includes('import "server-only"'));
  });

  it("exports buildTrustLayer function", () => {
    const content = fs.readFileSync(BUILDER_PATH, "utf-8");
    assert.ok(content.includes("export async function buildTrustLayer"));
  });
});

// ── 3. No duplicate provenance/status engine ─────────────────────────────────

describe("No duplicate logic — reuses canonical sources", () => {
  it("builder uses computeMemoInputHash from memoProvenance", () => {
    const content = fs.readFileSync(BUILDER_PATH, "utf-8");
    assert.ok(content.includes("computeMemoInputHash"));
    assert.ok(content.includes("memoProvenance"));
  });

  it("builder uses checkMemoStaleness from memoProvenance", () => {
    const content = fs.readFileSync(BUILDER_PATH, "utf-8");
    assert.ok(content.includes("checkMemoStaleness"));
  });

  it("builder uses buildCommitteeFinancialValidationSummary", () => {
    const content = fs.readFileSync(BUILDER_PATH, "utf-8");
    assert.ok(content.includes("buildCommitteeFinancialValidationSummary"));
  });

  it("builder uses runPacketPreflight", () => {
    const content = fs.readFileSync(BUILDER_PATH, "utf-8");
    assert.ok(content.includes("runPacketPreflight"));
  });

  it("builder does NOT implement its own hash computation", () => {
    const content = fs.readFileSync(BUILDER_PATH, "utf-8");
    // Should not contain createHash — that's in memoProvenance.ts
    assert.ok(!content.includes("createHash"), "Builder must not re-implement hashing");
  });

  it("builder does NOT implement its own financial gate logic", () => {
    const content = fs.readFileSync(BUILDER_PATH, "utf-8");
    assert.ok(!content.includes("getFinancialSnapshotGate"), "Builder must use committee summary, not raw gate");
  });
});

// ── 4. State route exposes trustLayer ────────────────────────────────────────

describe("Underwrite state route", () => {
  it("imports buildTrustLayer", () => {
    const content = fs.readFileSync(STATE_ROUTE_PATH, "utf-8");
    assert.ok(content.includes("buildTrustLayer"));
  });

  it("includes trustLayer in response", () => {
    const content = fs.readFileSync(STATE_ROUTE_PATH, "utf-8");
    assert.ok(content.includes("trustLayer"));
  });
});

// ── 5. AnalystWorkbench renders trust layer ──────────────────────────────────

describe("AnalystWorkbench integration", () => {
  it("imports UnderwriteTrustLayer", () => {
    const content = fs.readFileSync(WORKBENCH_PATH, "utf-8");
    assert.ok(content.includes("UnderwriteTrustLayer"));
  });

  it("renders trust layer component", () => {
    const content = fs.readFileSync(WORKBENCH_PATH, "utf-8");
    assert.ok(content.includes("<UnderwriteTrustLayer"));
  });

  it("still renders SnapshotBanner", () => {
    const content = fs.readFileSync(WORKBENCH_PATH, "utf-8");
    assert.ok(content.includes("<SnapshotBanner"));
  });

  it("still renders DriftBanner", () => {
    const content = fs.readFileSync(WORKBENCH_PATH, "utf-8");
    assert.ok(content.includes("<DriftBanner"));
  });

  it("still renders WorkstreamCard", () => {
    const content = fs.readFileSync(WORKBENCH_PATH, "utf-8");
    assert.ok(content.includes("<WorkstreamCard"));
  });

  it("trustLayer in state type", () => {
    const content = fs.readFileSync(WORKBENCH_PATH, "utf-8");
    assert.ok(content.includes("trustLayer"));
  });
});

// ── 6. UI components are presentation-only ──────────────────────────────────

describe("Trust layer UI components are presentation-only", () => {
  for (const [name, filePath] of [
    ["UnderwriteTrustLayer", TRUST_LAYER_PATH],
    ["MemoFreshnessCard", MEMO_CARD_PATH],
    ["PacketReadinessCard", PACKET_CARD_PATH],
    ["FinancialValidationCard", FIN_CARD_PATH],
  ] as const) {
    it(`${name} is a client component`, () => {
      const content = fs.readFileSync(filePath, "utf-8");
      assert.ok(content.startsWith('"use client"'));
    });

    it(`${name} does not import server-only`, () => {
      const content = fs.readFileSync(filePath, "utf-8");
      assert.ok(!content.includes('import "server-only"'), `${name} must not import server-only`);
    });

    it(`${name} does not import supabase`, () => {
      const content = fs.readFileSync(filePath, "utf-8");
      assert.ok(!content.includes("supabase"), `${name} must not directly access database`);
    });

    it(`${name} does not import provenance engine`, () => {
      const content = fs.readFileSync(filePath, "utf-8");
      assert.ok(!content.includes("memoProvenance"), `${name} must not import provenance engine`);
      assert.ok(!content.includes("packetPreflight"), `${name} must not import preflight engine`);
    });
  }
});

// ── 7. Memo card renders correct status states ──────────────────────────────

describe("MemoFreshnessCard status rendering", () => {
  const content = fs.readFileSync(MEMO_CARD_PATH, "utf-8");

  for (const status of ["fresh", "stale", "missing", "failed"]) {
    it(`handles "${status}" status`, () => {
      assert.ok(content.includes(status), `Must handle ${status} status`);
    });
  }

  it("shows regenerate button for stale/missing", () => {
    assert.ok(content.includes("Regenerate Memo"));
  });
});

// ── 8. Packet card renders correct status states ────────────────────────────

describe("PacketReadinessCard status rendering", () => {
  const content = fs.readFileSync(PACKET_CARD_PATH, "utf-8");

  for (const status of ["ready", "warning", "blocked", "missing"]) {
    it(`handles "${status}" status`, () => {
      assert.ok(content.includes(status), `Must handle ${status} status`);
    });
  }

  it("shows generate button when not blocked", () => {
    assert.ok(content.includes("Generate Packet"));
  });
});

// ── 9. Financial card renders memoSafe/decisionSafe ─────────────────────────

describe("FinancialValidationCard rendering", () => {
  const content = fs.readFileSync(FIN_CARD_PATH, "utf-8");

  it("renders memoSafe indicator", () => {
    assert.ok(content.includes("Memo-safe") || content.includes("memoSafe"));
  });

  it("renders decisionSafe indicator", () => {
    assert.ok(content.includes("Decision-safe") || content.includes("decisionSafe"));
  });

  it("provides view provenance action", () => {
    assert.ok(content.includes("View Provenance"));
  });
});

// ── 10. Safe degradation — builder handles missing data ─────────────────────

describe("Safe degradation in builder", () => {
  const content = fs.readFileSync(BUILDER_PATH, "utf-8");

  it("catches errors in memo trust builder", () => {
    assert.ok(content.includes("catch") && content.includes("memo trust failed"));
  });

  it("catches errors in packet trust builder", () => {
    assert.ok(content.includes("packet trust failed"));
  });

  it("catches errors in financial validation trust builder", () => {
    assert.ok(content.includes("financial validation trust failed"));
  });

  it("returns failed/missing status on error, not throw", () => {
    // Each catch block should return a safe degraded object
    assert.ok(content.includes('status: "failed"') || content.includes('status: "missing"'));
  });
});

// ── 11. No parallel control plane or route ──────────────────────────────────

describe("No parallel control plane", () => {
  it("no trust-layer-specific API route exists", () => {
    const trustApiPath = path.resolve(__dirname, "../../../app/api/deals/[dealId]/underwrite/trust");
    assert.ok(!fs.existsSync(trustApiPath), "Must not create a separate trust API route");
  });

  it("trust layer flows through existing state route only", () => {
    const stateContent = fs.readFileSync(STATE_ROUTE_PATH, "utf-8");
    assert.ok(stateContent.includes("trustLayer"));
  });
});

// ── 12. Existing workspace still renders all elements ───────────────────────

describe("Existing workspace render integrity", () => {
  const content = fs.readFileSync(WORKBENCH_PATH, "utf-8");

  it("still has 3-column workstream grid", () => {
    assert.ok(content.includes("grid-cols-3"));
  });

  it("still has Spreads workstream", () => {
    assert.ok(content.includes('"Spreads"'));
  });

  it("still has Credit Memo workstream", () => {
    assert.ok(content.includes('"Credit Memo"'));
  });

  it("still has Risk & Structure workstream", () => {
    assert.ok(content.includes('"Risk & Structure"'));
  });
});

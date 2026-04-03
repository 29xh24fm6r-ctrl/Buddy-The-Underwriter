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

// ── 13. Memo hash consistency — trust layer uses shared fetchMemoHashInputs ──

const MEMO_GEN_ROUTE_PATH = path.resolve(
  __dirname,
  "../../../app/api/deals/[dealId]/credit-memo/generate/route.ts",
);
const FETCH_HASH_INPUTS_PATH = path.resolve(
  __dirname,
  "../../../lib/creditMemo/canonical/fetchMemoHashInputs.ts",
);

describe("Memo hash consistency", () => {
  it("fetchMemoHashInputs.ts exists", () => {
    assert.ok(fs.existsSync(FETCH_HASH_INPUTS_PATH));
  });

  it("fetchMemoHashInputs is server-only", () => {
    const content = fs.readFileSync(FETCH_HASH_INPUTS_PATH, "utf-8");
    assert.ok(content.includes('import "server-only"'));
  });

  it("trust layer builder uses fetchMemoHashInputs", () => {
    const content = fs.readFileSync(BUILDER_PATH, "utf-8");
    assert.ok(
      content.includes("fetchMemoHashInputs"),
      "Trust layer must use shared canonical hash input assembly",
    );
  });

  it("memo generation route uses fetchMemoHashInputs", () => {
    const content = fs.readFileSync(MEMO_GEN_ROUTE_PATH, "utf-8");
    assert.ok(
      content.includes("fetchMemoHashInputs"),
      "Memo generation route must use shared canonical hash input assembly",
    );
  });

  it("trust layer builder does NOT inline its own fact query for hash", () => {
    const content = fs.readFileSync(BUILDER_PATH, "utf-8");
    // Should not have the old presence-check pattern
    assert.ok(
      !content.includes("factCount = factsRes.data ? 1 : 0"),
      "Trust layer must not use presence-check for factCount",
    );
  });

  it("memo generation route does NOT inline its own hash input assembly", () => {
    const content = fs.readFileSync(MEMO_GEN_ROUTE_PATH, "utf-8");
    // Should not have the old inline snapshot/pricing fetch for hash
    assert.ok(
      !content.includes("deal_financial_snapshots"),
      "Memo route must use fetchMemoHashInputs instead of inline snapshot query",
    );
  });

  it("fetchMemoHashInputs uses facts.length for factCount", () => {
    const content = fs.readFileSync(FETCH_HASH_INPUTS_PATH, "utf-8");
    assert.ok(
      content.includes("facts.length"),
      "factCount must use actual count, not presence check",
    );
  });

  it("computeMemoInputHash pure function determines hash from factCount", () => {
    // Verify the pure function actually uses factCount in the hash
    const { computeMemoInputHash } = require("@/lib/creditMemo/canonical/memoProvenance");
    const hash1 = computeMemoInputHash({
      snapshotId: "s1", snapshotUpdatedAt: "t1",
      pricingDecisionId: "p1", pricingUpdatedAt: "t2",
      factCount: 5, latestFactUpdatedAt: "t3",
    });
    const hash2 = computeMemoInputHash({
      snapshotId: "s1", snapshotUpdatedAt: "t1",
      pricingDecisionId: "p1", pricingUpdatedAt: "t2",
      factCount: 10, latestFactUpdatedAt: "t3",
    });
    assert.notEqual(hash1, hash2, "Different factCounts must produce different hashes");
  });
});

// ── 14. Packet event consistency — reads canonical domain event ──────────────

describe("Packet event consistency", () => {
  it("trust layer reads deal.committee.packet.generated event", () => {
    const content = fs.readFileSync(BUILDER_PATH, "utf-8");
    assert.ok(
      content.includes("deal.committee.packet.generated"),
      "Trust layer must read the canonical domain event for packet generation",
    );
  });

  it("trust layer does NOT read the ghost 'packet.generated' event", () => {
    const content = fs.readFileSync(BUILDER_PATH, "utf-8");
    // The canonical name "deal.committee.packet.generated" contains "packet.generated"
    // as a substring, so we check for the exact non-canonical standalone usage
    const lines = content.split("\n");
    const ghostUsages = lines.filter(
      (l) => l.includes('"packet.generated"') && !l.includes("deal.committee.packet.generated"),
    );
    assert.equal(
      ghostUsages.length,
      0,
      "Trust layer must not read the non-canonical 'packet.generated' event",
    );
  });

  it("packet generation route writes deal.committee.packet.generated", () => {
    const packetRoutePath = path.resolve(
      __dirname,
      "../../../app/api/deals/[dealId]/committee/packet/generate/route.ts",
    );
    const content = fs.readFileSync(packetRoutePath, "utf-8");
    assert.ok(
      content.includes("deal.committee.packet.generated"),
      "Packet generation route must write canonical domain event",
    );
  });

  it("lifecycle reads deal.committee.packet.generated", () => {
    const lifecyclePath = path.resolve(__dirname, "../../../buddy/lifecycle/deriveLifecycleState.ts");
    const content = fs.readFileSync(lifecyclePath, "utf-8");
    assert.ok(
      content.includes("deal.committee.packet.generated"),
      "Lifecycle must read same canonical packet event as trust layer",
    );
  });

  it("trust layer degrades gracefully when no packet event exists", () => {
    const content = fs.readFileSync(BUILDER_PATH, "utf-8");
    // packetEventRes.data can be null — lastGeneratedAt defaults to null
    assert.ok(
      content.includes("packetEventRes.data"),
      "Must handle null packet event result",
    );
  });
});

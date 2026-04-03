import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const BADGE_PATH = path.resolve(__dirname, "../OmegaAdvisoryBadge.tsx");
const BANNER_PATH = path.resolve(__dirname, "../CanonicalStateBanner.tsx");

describe("OmegaAdvisoryBadge structural guards", () => {
  const content = fs.readFileSync(BADGE_PATH, "utf-8");

  it("file exists", () => {
    assert.ok(fs.existsSync(BADGE_PATH));
  });

  it("imports OmegaAdvisoryState from core/omega/types", () => {
    assert.ok(content.includes("@/core/omega/types"));
  });

  it("renders stale state with 'Advisory unavailable'", () => {
    assert.ok(content.includes("Advisory unavailable"));
  });

  it("handles green threshold >= 80", () => {
    assert.ok(content.includes("score >= 80"));
    assert.ok(content.includes("bg-green-100"));
  });

  it("handles amber threshold >= 60", () => {
    assert.ok(content.includes("score >= 60"));
    assert.ok(content.includes("bg-amber-100"));
  });

  it("handles red threshold < 60", () => {
    assert.ok(content.includes("bg-red-100"));
  });

  it("supports compact mode that hides advisory and risk signals", () => {
    assert.ok(content.includes("compact"));
    assert.ok(content.includes("!compact && omega.advisory"));
    assert.ok(content.includes("!compact && omega.riskEmphasis"));
  });

  it("returns null when confidence is negative", () => {
    assert.ok(content.includes("score < 0"));
    assert.ok(content.includes("return null"));
  });

  it("is a client component", () => {
    assert.ok(content.startsWith('"use client"'));
  });

  it("never imports supabaseAdmin", () => {
    assert.ok(!content.includes("supabaseAdmin"));
  });
});

describe("CanonicalStateBanner structural guards", () => {
  const content = fs.readFileSync(BANNER_PATH, "utf-8");

  it("file exists", () => {
    assert.ok(fs.existsSync(BANNER_PATH));
  });

  it("imports SystemAction from core/state/types", () => {
    assert.ok(content.includes("@/core/state/types"));
  });

  it("handles blocked intent", () => {
    assert.ok(content.includes('"blocked"'));
  });

  it("handles complete intent", () => {
    assert.ok(content.includes('"complete"'));
  });

  it("supports strip and card variants", () => {
    assert.ok(content.includes('"strip"'));
    assert.ok(content.includes('"card"'));
  });

  it("is a client component", () => {
    assert.ok(content.startsWith('"use client"'));
  });
});

describe("CommitteeView uses canonical state API", () => {
  const content = fs.readFileSync(
    path.resolve(__dirname, "../../../../app/(app)/deals/[dealId]/committee/CommitteeView.tsx"),
    "utf-8",
  );

  it("fetches from /api/deals/${dealId}/state", () => {
    assert.ok(content.includes("/api/deals/${dealId}/state"));
  });

  it("renders OmegaAdvisoryBadge", () => {
    assert.ok(content.includes("OmegaAdvisoryBadge"));
  });

  it("renders CanonicalStateBanner", () => {
    assert.ok(content.includes("CanonicalStateBanner"));
  });

  it("renders CommitteeDecisionPanel", () => {
    assert.ok(content.includes("CommitteeDecisionPanel"));
  });

  it("does not import StitchSurface", () => {
    assert.ok(!content.includes("StitchSurface"));
  });
});

describe("AnalystWorkbench Omega integration", () => {
  const content = fs.readFileSync(
    path.resolve(__dirname, "../../../underwrite/AnalystWorkbench.tsx"),
    "utf-8",
  );

  it("imports OmegaAdvisoryBadge", () => {
    assert.ok(content.includes("OmegaAdvisoryBadge"));
  });

  it("fetches omega from /api/deals/${dealId}/state", () => {
    assert.ok(content.includes("/api/deals/${dealId}/state"));
  });

  it("renders OmegaAdvisoryBadge in compact mode", () => {
    assert.ok(content.includes("compact"));
  });
});

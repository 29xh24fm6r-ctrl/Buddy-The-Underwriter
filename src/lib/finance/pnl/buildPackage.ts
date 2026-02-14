// src/lib/finance/pnl/buildPackage.ts
import "server-only";

import type { PnlAnalysisPackage, NormalizedPnl } from "@/lib/finance/types";
import { computePnlMetrics } from "./compute";

export function buildPnlAnalysisPackage(args: {
  dealId: string;
  jobId: string;
  pnl?: NormalizedPnl | null;
}): PnlAnalysisPackage {
  const { dealId, jobId, pnl } = args;

  const metrics = pnl ? computePnlMetrics(pnl) : [];

  const flags: PnlAnalysisPackage["flags"] = [];

  if (!pnl) {
    flags.push({
      severity: "warn",
      message: "No normalized P&L available yet.",
    });
  } else {
    if (pnl.meta.confidence < 60) {
      flags.push({
        severity: "warn",
        message: `Low extraction confidence (${pnl.meta.confidence}%).`,
      });
    }

    if (pnl.depreciation_amortization === null) {
      flags.push({
        severity: "info",
        message: "Depreciation & amortization not found; EBITDA may be understated.",
      });
    }

    if (pnl.interest_expense === null) {
      flags.push({
        severity: "info",
        message: "Interest expense not found; coverage ratios may be unavailable.",
      });
    }
  }

  return {
    dealId,
    jobId,
    generatedAt: new Date().toISOString(),

    pnl: pnl ?? null,
    bs: null,
    cf: null,

    metrics,
    flags,
  };
}

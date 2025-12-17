// src/lib/intelligence/c4PnLInsights.ts
import "server-only";

export type PnLLineItem = {
  label: string;
  // values keyed by period label (e.g., "2024", "2025", "YTD 6/30/24")
  values: Record<string, number | null>;
};

export type C4PnLExtract = {
  kind: "C4_PNL";
  periods: string[]; // left-to-right as seen in table
  currency_hint?: string | null;
  line_items: PnLLineItem[];
  totals: {
    revenue?: Record<string, number | null>;
    cogs?: Record<string, number | null>;
    gross_profit?: Record<string, number | null>;
    operating_expense?: Record<string, number | null>;
    operating_income?: Record<string, number | null>;
    net_income?: Record<string, number | null>;
  };
  evidence?: {
    table_index?: number | null;
    notes?: string[];
  };
};

export type C4PnLInsights = {
  kind: "C4_PNL_INSIGHTS";
  metrics: {
    gross_margin_pct?: Record<string, number | null>;
    operating_margin_pct?: Record<string, number | null>;
    net_margin_pct?: Record<string, number | null>;
    yoy_revenue_growth_pct?: Record<string, number | null>;
  };
  flags: Array<{
    flag: string;
    severity: "info" | "warning" | "critical";
    why: string;
    period?: string | null;
  }>;
  underwriter_questions: string[];
};

function safeNum(n: any): number | null {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  return null;
}

function pct(numer: number | null, denom: number | null): number | null {
  if (!Number.isFinite(numer ?? NaN) || !Number.isFinite(denom ?? NaN)) return null;
  if (!denom || denom === 0) return null;
  return (numer! / denom) * 100;
}

function yoyPct(cur: number | null, prev: number | null): number | null {
  if (!Number.isFinite(cur ?? NaN) || !Number.isFinite(prev ?? NaN)) return null;
  if (!prev || prev === 0) return null;
  return ((cur! - prev) / prev) * 100;
}

function pickLastTwoPeriods(periods: string[]): { prev?: string; cur?: string } {
  if (!Array.isArray(periods) || periods.length < 2) return {};
  const cur = periods[periods.length - 1];
  const prev = periods[periods.length - 2];
  return { prev, cur };
}

export function buildPnLInsights(pnl: C4PnLExtract | null | undefined): C4PnLInsights | null {
  if (!pnl || pnl.kind !== "C4_PNL") return null;

  const periods = pnl.periods || [];
  const revenue = pnl.totals.revenue ?? {};
  const gross = pnl.totals.gross_profit ?? {};
  const opInc = pnl.totals.operating_income ?? {};
  const net = pnl.totals.net_income ?? {};

  const gross_margin_pct: Record<string, number | null> = {};
  const operating_margin_pct: Record<string, number | null> = {};
  const net_margin_pct: Record<string, number | null> = {};

  for (const p of periods) {
    gross_margin_pct[p] = pct(safeNum(gross[p]), safeNum(revenue[p]));
    operating_margin_pct[p] = pct(safeNum(opInc[p]), safeNum(revenue[p]));
    net_margin_pct[p] = pct(safeNum(net[p]), safeNum(revenue[p]));
  }

  const metrics: C4PnLInsights["metrics"] = {
    gross_margin_pct,
    operating_margin_pct,
    net_margin_pct,
  };

  // YoY revenue growth (only last two periods)
  const { prev, cur } = pickLastTwoPeriods(periods);
  if (prev && cur) {
    const yoy_revenue_growth_pct: Record<string, number | null> = {};
    yoy_revenue_growth_pct[cur] = yoyPct(safeNum(revenue[cur]), safeNum(revenue[prev]));
    metrics.yoy_revenue_growth_pct = yoy_revenue_growth_pct;
  }

  const flags: C4PnLInsights["flags"] = [];
  const questions: string[] = [];

  // Helper for flags
  const addFlag = (
    flag: string,
    severity: "info" | "warning" | "critical",
    why: string,
    period?: string | null
  ) => {
    flags.push({ flag, severity, why, period: period ?? null });
  };

  // Core sanity checks + underwriting signals
  for (const p of periods) {
    const r = safeNum(revenue[p]);
    const ni = safeNum(net[p]);
    const oi = safeNum(opInc[p]);
    const gm = safeNum(gross_margin_pct[p]);

    if (r !== null && r > 0) {
      if (ni === null && oi === null) {
        addFlag(
          "Missing bottom-line totals",
          "warning",
          "Revenue is present but Operating Income and Net Income were not confidently detected.",
          p
        );
        questions.push(`Provide the full P&L page(s) for period "${p}" so we can confirm operating and net income.`);
      }

      if (gm === null) {
        addFlag(
          "Gross margin not computed",
          "info",
          "Revenue detected but Gross Profit/COGS not confidently detected.",
          p
        );
        questions.push(`Confirm COGS / Gross Profit breakout for period "${p}" (gross margin needed for risk review).`);
      } else {
        if (gm < 15) {
          addFlag("Thin gross margin", "warning", `Gross margin is ~${gm.toFixed(1)}% (thin).`, p);
          questions.push(`Explain margin drivers for period "${p}" (pricing, mix, COGS inflation, labor, shrink, etc.).`);
        }
        if (gm < 5) {
          addFlag("Extremely thin gross margin", "critical", `Gross margin is ~${gm.toFixed(1)}% (very weak).`, p);
        }
      }

      if (oi !== null && oi < 0 && ni !== null && ni > 0) {
        addFlag(
          "Net income positive while operating income is negative",
          "warning",
          "This often indicates non-operating income, one-time items, or accounting presentation artifacts.",
          p
        );
        questions.push(`Break out non-operating/other income for period "${p}" and identify any one-time items.`);
      }

      const nm = safeNum(net_margin_pct[p]);
      if (nm !== null && nm < 0) {
        addFlag("Negative net margin", "critical", `Net margin is ~${nm.toFixed(1)}% (loss).`, p);
        questions.push(`Describe primary loss drivers for period "${p}" and remediation plan.`);
      }
    }
  }

  // Trend flags (last two periods)
  if (prev && cur) {
    const rPrev = safeNum(revenue[prev]);
    const rCur = safeNum(revenue[cur]);
    const gmPrev = safeNum(gross_margin_pct[prev]);
    const gmCur = safeNum(gross_margin_pct[cur]);

    const yoy = metrics.yoy_revenue_growth_pct?.[cur] ?? null;
    if (yoy !== null) {
      if (yoy < -10) {
        addFlag("Revenue decline YoY", "warning", `Revenue down ~${yoy.toFixed(1)}% vs prior period.`, cur);
        questions.push(`Explain revenue decline into "${cur}" (customer loss, volume, pricing, seasonality, disruption).`);
      }
      if (yoy < -25) {
        addFlag("Sharp revenue decline YoY", "critical", `Revenue down ~${yoy.toFixed(1)}% vs prior period.`, cur);
      }
    }

    if (gmPrev !== null && gmCur !== null) {
      const delta = gmCur - gmPrev;
      if (delta < -5) {
        addFlag(
          "Margin compression",
          "warning",
          `Gross margin compressed by ~${Math.abs(delta).toFixed(1)} pts vs prior period.`,
          cur
        );
        questions.push(`Explain margin compression into "${cur}" (COGS changes, pricing pressure, mix shift).`);
      }
      if (delta < -10) {
        addFlag(
          "Severe margin compression",
          "critical",
          `Gross margin compressed by ~${Math.abs(delta).toFixed(1)} pts vs prior period.`,
          cur
        );
      }
    }

    // Basic reasonableness check
    if (rPrev !== null && rCur !== null && rCur > 0 && rPrev > 0) {
      const ratio = rCur / rPrev;
      if (ratio > 3) {
        addFlag(
          "Revenue jump",
          "warning",
          `Revenue appears to have increased >3x between "${prev}" and "${cur}". Confirm period labels and units.`,
          cur
        );
        questions.push(`Confirm the period labels/units on the P&L (monthly vs annual, $ vs $000).`);
      }
    }
  }

  // Dedup + cap
  const dedupQ = Array.from(new Set(questions)).slice(0, 12);

  return {
    kind: "C4_PNL_INSIGHTS",
    metrics,
    flags: flags.slice(0, 20),
    underwriter_questions: dedupQ,
  };
}

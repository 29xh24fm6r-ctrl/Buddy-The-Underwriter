/**
 * SPEC-FINENGINE-FULL-SPREAD-SHADOW-1 — full-spread shadow runner (read-only, report-only).
 *
 * First real execution of the finengine's complete diagnostic spread against live
 * deals. For each target deal it loads `deal_financial_facts`, runs
 * `runFullSpreadShadow`, and prints:
 *   (a) the GATED ShadowReport over OVERLAPPING_METRICS (EBITDA…) — total/zero/
 *       intended/unexpected + cutoverBlocked, driven ONLY by overlapping divergences;
 *   (b) the full net-new credit-measurement universe (additiveMetrics) grouped by
 *       family with a rating per metric — proving the measurements are correct on
 *       real data.
 *
 * Writes NO canonical fact (NG1) — output is the console only. The golden set is
 * the empty default; Phase 2 populates it.
 *
 * Run:  pnpm tsx --conditions=react-server scripts/finengine-shadow-fullspread.ts [dealId ...]
 * Default deal: OmniCare. Pass Samaritus (0279ed32-…) explicitly for the second
 * entity shape (V-2). Required env: SUPABASE_URL (+ a service key).
 */

import process from "node:process";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runFullSpreadShadow } from "@/lib/finengine/shadow/runFullSpreadShadow";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

const OMNICARE = "eefd62b3-4ae2-4d43-bb80-9953fdca9bcc";
const dealIds = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const targets = dealIds.length > 0 ? dealIds : [OMNICARE];

async function loadRows(dealId: string): Promise<CertifiedFactRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await (sb as any)
    .from("deal_financial_facts")
    .select(
      "fact_key, fact_value_num, fact_period_end, owner_type, is_superseded, source_canonical_type, confidence, provenance, source_document_id, created_at",
    )
    .eq("deal_id", dealId);
  if (error) throw new Error(`load ${dealId}: ${error.message}`);
  return (data ?? []).map((r: any) => ({
    fact_key: r.fact_key,
    fact_value_num: r.fact_value_num,
    fact_period_end: r.fact_period_end,
    owner_type: r.owner_type,
    is_superseded: r.is_superseded,
    source_canonical_type: r.source_canonical_type ?? null,
    confidence: r.confidence ?? null,
    extractor: r.provenance?.extractor ?? null,
    source_document_id: r.source_document_id ?? null,
    created_at: r.created_at ?? null,
  })) as CertifiedFactRow[];
}

function fmt(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

async function main() {
  console.log(`\n=== finengine FULL-SPREAD shadow run (read-only) — ${targets.length} deal(s) ===\n`);
  for (const dealId of targets) {
    const rows = await loadRows(dealId);
    if (rows.length === 0) {
      console.log(`[${dealId.slice(0, 8)}] no facts on file — skipped.`);
      continue;
    }

    const { spread, report, additiveMetrics } = runFullSpreadShadow(dealId, rows);

    // (a) GATED report over the overlapping set.
    console.log(
      `\n[${dealId.slice(0, 8)}] GATED report (OVERLAPPING_METRICS)  ` +
        `total=${report.total} ZERO=${report.zero} INTENDED=${report.intended} UNEXPECTED=${report.unexpected}  ` +
        `cutoverBlocked=${report.cutoverBlocked}`,
    );
    for (const d of report.divergences) {
      console.log(
        `   ${d.classification.padEnd(10)} ${d.factKey} ${d.fiscalPeriodEnd} [${d.ownerType}]  ` +
          `legacy=${fmt(d.legacyValue)} new=${fmt(d.newValue)}` +
          (d.note ? `  (${d.note})` : ""),
      );
    }
    if (report.divergences.length === 0) {
      console.log(`   (no overlapping legacy facts to gate against — additive-only on this deal)`);
    }

    // (b) ADDITIVE universe grouped by family / scope.
    console.log(
      `\n[${dealId.slice(0, 8)}] ADDITIVE credit-measurement universe — ${additiveMetrics.length} net-new metric cell(s):`,
    );
    const byFamily = new Map<string, AdditiveLike[]>();
    for (const m of additiveMetrics) {
      const arr = byFamily.get(m.family) ?? [];
      arr.push(m);
      byFamily.set(m.family, arr);
    }
    for (const family of [...byFamily.keys()].sort()) {
      const cells = byFamily.get(family)!;
      console.log(`  ── ${family} (${cells.length}) ──`);
      for (const m of cells) {
        console.log(
          `     ${m.metric.padEnd(28)} ${m.scope.padEnd(9)} ${m.period.padEnd(12)} ` +
            `${fmt(m.value).padStart(14)}  [${m.rating}]  ${m.meaning}`,
        );
      }
    }
    if (spread.warnings.length) {
      console.log(`\n  ⚠ spread warnings (${spread.warnings.length}):`);
      for (const w of spread.warnings.slice(0, 20)) console.log(`     - ${w}`);
      if (spread.warnings.length > 20) console.log(`     … +${spread.warnings.length - 20} more`);
    }
  }
  console.log(`\n=== done (read-only — no canonical fact written) ===\n`);
}

type AdditiveLike = { family: string; metric: string; scope: string; period: string; value: number; rating: string; meaning: string };

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

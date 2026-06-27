/**
 * SPEC-FINENGINE-SHADOW-EBITDA-1 — EBITDA shadow runner (read-only, report-only).
 *
 * First real execution of finengine.core against live deals. For each target
 * deal it loads `deal_financial_facts`, runs the engine's EBITDA method ALONGSIDE
 * an independent golden-set, and prints a ShadowReport. Writes NO canonical fact
 * (NG1) — output is the console + docs/finengine/SHADOW_EBITDA_REPORT.md (authored
 * by the operator from this output).
 *
 * Run:  pnpm tsx --conditions=react-server scripts/finengine-shadow-ebitda.ts [dealId ...]
 * Default deal: OmniCare (80fe6f7a-5c68-4f02-8bcf-933f246a9fc5).
 * Required env: SUPABASE_URL (+ a service key) — same as other scripts.
 */

import process from "node:process";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runEbitdaShadow } from "@/lib/finengine/shadow/runEbitdaShadow";
import type { AdapterFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

const OMNICARE = "80fe6f7a-5c68-4f02-8bcf-933f246a9fc5";
const dealIds = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const targets = dealIds.length > 0 ? dealIds : [OMNICARE];

async function loadRows(dealId: string): Promise<AdapterFactRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await (sb as any)
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num, fact_period_end, owner_type, is_superseded")
    .eq("deal_id", dealId);
  if (error) throw new Error(`load ${dealId}: ${error.message}`);
  return (data ?? []) as AdapterFactRow[];
}

function fmt(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

async function main() {
  console.log(`\n=== finengine EBITDA shadow run (read-only) — ${targets.length} deal(s) ===\n`);
  for (const dealId of targets) {
    const rows = await loadRows(dealId);
    if (rows.length === 0) {
      console.log(`[${dealId.slice(0, 8)}] no facts on file — skipped.`);
      continue;
    }
    const { periods, report } = runEbitdaShadow(dealId, rows);
    console.log(`\n[${dealId.slice(0, 8)}] periods=${periods.length}  ZERO=${report.zero} INTENDED=${report.intended} UNEXPECTED=${report.unexpected}  cutoverBlocked=${report.cutoverBlocked}`);
    for (const p of periods) {
      console.log(
        `  ${p.fiscalPeriodEnd}${p.isAggregate ? " (TTM)" : ""} [${p.ownerType}]  ` +
          `base ${p.base.key}=${fmt(p.base.value)}  engineEBITDA=${fmt(p.engineEbitda)}  goldenEBITDA=${fmt(p.goldenEbitda)}  ` +
          `engineADJ=${fmt(p.engineAdjustedEbitda)}  legacy=${fmt(p.legacyEbitda)}`,
      );
      if (p.warnings.length) console.log(`      ⚠ ${p.warnings.join("; ")}`);
    }
    const unexpected = report.divergences.filter((d) => d.classification === "UNEXPECTED");
    if (unexpected.length) {
      console.log(`  UNEXPECTED divergences (root-cause before any cutover):`);
      for (const d of unexpected) console.log(`   - ${d.factKey} ${d.fiscalPeriodEnd}: legacy=${fmt(d.legacyValue)} new=${fmt(d.newValue)} (${d.note ?? ""})`);
    }
  }
  console.log(`\n=== done (read-only — no canonical fact written) ===\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

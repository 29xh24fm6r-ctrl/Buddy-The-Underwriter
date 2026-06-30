/**
 * SPEC-FINENGINE-GLOBAL-CASHFLOW-ASSEMBLER-1 — global cash flow runner (read-only).
 *
 * First end-to-end run of the finengine's GLOBAL cash flow on a real deal: loads the
 * deal's certified facts, assembles the EntityGraph + per-entity cash-flow structs,
 * runs `computeGlobalCashFlow`, and prints the node model, the source-and-use ledger
 * (with `singleCountVerified`), the global DSCR, and every warning.
 *
 * Writes NO canonical fact (NG1) — console only.
 *
 * Run:  pnpm tsx --conditions=react-server scripts/finengine-global-cashflow.ts [dealId ...]
 * Default deal: OmniCare. Pass Samaritus (0279ed32-…) for a thinner second shape.
 * Required env: SUPABASE_URL (+ a service key).
 */

import process from "node:process";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runGlobalCashFlowShadow } from "@/lib/finengine/shadow/globalCashFlowAdapter";
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
  console.log(`\n=== finengine GLOBAL cash flow run (read-only) — ${targets.length} deal(s) ===\n`);
  for (const dealId of targets) {
    const rows = await loadRows(dealId);
    if (rows.length === 0) {
      console.log(`[${dealId.slice(0, 8)}] no facts on file — skipped.`);
      continue;
    }

    const { inputs, result } = runGlobalCashFlowShadow(dealId, rows);
    console.log(`[${dealId.slice(0, 8)}] analysisPeriod=${inputs.analysisPeriod}`);

    console.log(`\n  ── BUSINESS node(s) ──`);
    for (const b of inputs.business) {
      console.log(`     ${b.nodeId}  operatingCashFlow(EBITDA, pre-distribution)=${fmt(b.operatingCashFlow)}  businessDebtService(incl. proposed)=${fmt(b.businessDebtService)}`);
      console.log(`        provenance: ${b.ncadsProvenance.note}`);
    }

    console.log(`\n  ── PERSONAL guarantor node(s) ──`);
    if (inputs.personal.length === 0) console.log(`     (none — business-only)`);
    for (const p of inputs.personal) {
      const inc = p.income;
      console.log(`     ${p.nodeId}  wages=${fmt(inc.wages)} netRental=${fmt(inc.netRental)} investment=${fmt(inc.investment)} other=${fmt(inc.other)}`);
      console.log(`        personalDebtService=${fmt(p.personalDebtService)}  livingExpenses.stated=${fmt(p.livingExpenses.stated ?? null)}`);
      console.log(`        (single-count: K-1 Box 1 and distributions are EXCLUDED from income)`);
    }

    console.log(`\n  ── source-and-use ledger (distributions = internal transfer) ──`);
    if (result.ledger.length === 0) console.log(`     (no distributions)`);
    for (const l of result.ledger) console.log(`     ${l.kind} → ${l.node}: ${fmt(l.amount)} [${l.effect}]`);
    console.log(`     singleCountVerified=${result.singleCountVerified}`);

    console.log(`\n  ── GLOBAL cash flow ──`);
    console.log(`     businessOperating(net)=${fmt(result.businessOperating)}  personalContribution=${fmt(result.personalContribution)}  livingExpenses=${fmt(result.totalLivingExpenses)}`);
    console.log(`     globalCashBeforeDebt=${fmt(result.globalCashBeforeDebt)}`);
    console.log(`     globalDebtService=${fmt(result.globalDebtService)}  (= business + personal; includes proposed loan + personal guarantees)`);
    console.log(`     >>> globalDSCR=${result.globalDSCR == null ? "—" : result.globalDSCR.toFixed(3)} <<<`);

    const allWarnings = [...inputs.warnings, ...result.warnings];
    if (allWarnings.length) {
      console.log(`\n  ⚠ warnings (${allWarnings.length}):`);
      for (const w of allWarnings) console.log(`     - ${w}`);
    }
    console.log("");
  }
  console.log(`=== done (read-only — no canonical fact written) ===\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

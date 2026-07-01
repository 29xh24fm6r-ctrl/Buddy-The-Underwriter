/**
 * SPEC-FINENGINE-RECONCILIATION-MATRIX-1 §4 — multi-deal reconciliation matrix runner
 * (cutover phase 3, option C). Read-only.
 *
 * Sweeps the three finengine shadow harnesses (full-spread, global cash flow,
 * decision-core) across a RESOLVED deal set and prints a single
 * ZERO/INTENDED/UNEXPECTED matrix — per deal, by product, by bank — with one
 * cutover-readiness verdict. Proves it on the 6 populated OmniCare deals now; sweeps
 * real per-product deals automatically the moment they exist (the (B) data dependency
 * — a write-path only Matt can do).
 *
 * HONEST SCOPE: the verdict lists products/banks PRESENT in the data — it never claims
 * coverage of the 7 products with zero deals. `cutoverReady` is scoped to the deals run.
 *
 * Writes NO canonical fact (NG1) — console (+ optional --json) only.
 *
 * Run:  pnpm tsx --conditions=react-server scripts/finengine-reconciliation-matrix.ts [--deal-type=CONVENTIONAL] [--bank=<id>] [--min-facts=50] [--json]
 * Required env: SUPABASE_URL (+ a service key).
 */

import process from "node:process";
import { loadCertifiedRows, loadDealSetEntries } from "./_loadCertifiedRows";
import { resolveDealSet, type DealSetFilter } from "@/lib/finengine/shadow/reconciliationDealSet";
import { runReconciliationMatrix, type ReconciliationMatrix } from "@/lib/finengine/shadow/reconciliationMatrix";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : undefined;
}
const asJson = process.argv.includes("--json");

function fmt(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}
function tick(blocked: boolean): string {
  return blocked ? "✗" : "✓";
}

function printMatrix(m: ReconciliationMatrix): void {
  console.log(`\n=== finengine RECONCILIATION MATRIX (read-only) — ${m.dealsRun} deal(s) ===\n`);

  console.log(`  ── by deal ──`);
  for (const r of m.byDeal) {
    const d = r.deal;
    const fs = r.fullSpread;
    const dc = r.decisionCore;
    console.log(
      `  ${tick(r.cutoverBlocked)} [${d.dealId.slice(0, 8)}] ${d.name}\n` +
        `       product=${d.dealType} bank=${(d.bankId ?? "—").slice(0, 8)} stage=${d.stage} facts=${d.factCount} analysisPeriod=${r.analysisPeriod}\n` +
        `       EBITDA(full-spread): zero=${fs.zero} intended=${fs.intended} UNEXPECTED=${fs.unexpected}` +
        `   DSCR(decision-core): zero=${dc.zero} intended=${dc.intended} UNEXPECTED=${dc.unexpected}\n` +
        `       globalDSCR=${fmt(r.globalDSCR)} singleCountVerified=${r.singleCountVerified}` +
        (r.error ? `   ⚠ ERROR: ${r.error}` : ""),
    );
  }

  console.log(`\n  ── by product ──`);
  for (const [product, p] of Object.entries(m.byProduct)) {
    console.log(`  ${tick(p.cutoverBlocked)} ${product}: deals=${p.deals} zero=${p.zero} intended=${p.intended} UNEXPECTED=${p.unexpected} cutoverBlocked=${p.cutoverBlocked}`);
  }

  console.log(`\n  ── by bank ──`);
  for (const [bank, b] of Object.entries(m.byBank)) {
    console.log(`  ${tick(b.cutoverBlocked)} ${bank.slice(0, 8)}: deals=${b.deals} UNEXPECTED=${b.unexpected} cutoverBlocked=${b.cutoverBlocked}`);
  }

  console.log(`\n  ── VERDICT ──`);
  const v = m.verdict;
  console.log(`     cutoverReady=${v.cutoverReady}  (scoped to ${m.dealsRun} deal(s) in products {${v.productsPresent.join(", ")}}, banks {${v.banksPresent.map((x) => x.slice(0, 8)).join(", ")}})`);
  if (v.blockingDeals.length === 0) {
    console.log(`     no blocking deals.`);
  } else {
    console.log(`     blocking deals (${v.blockingDeals.length}):`);
    for (const bd of v.blockingDeals) console.log(`       - [${bd.dealId.slice(0, 8)}] ${bd.harness}: ${bd.unexpectedKeys.join(", ")}`);
  }
  console.log(`\n=== done (read-only — no canonical fact written) ===\n`);
}

async function main() {
  const filter: DealSetFilter = {
    dealType: flag("deal-type"),
    bankId: flag("bank"),
    minFacts: flag("min-facts") ? Number(flag("min-facts")) : undefined,
  };

  const allDeals = await loadDealSetEntries();
  const deals = resolveDealSet(allDeals, filter);

  if (deals.length === 0) {
    console.error(`no deals matched the filter (${JSON.stringify(filter)}); ${allDeals.length} deal(s) on file.`);
    process.exit(1);
  }

  const rowsByDeal: Record<string, CertifiedFactRow[]> = {};
  for (const d of deals) rowsByDeal[d.dealId] = await loadCertifiedRows(d.dealId);

  const matrix = runReconciliationMatrix(deals, rowsByDeal, { generatedAt: new Date().toISOString() });

  if (asJson) {
    console.log(JSON.stringify(matrix, null, 2));
  } else {
    printMatrix(matrix);
  }

  // Read-only diagnostic: non-zero exit when the swept set is NOT cutover-ready, so a
  // future CI wiring (a later spec) can gate on it. Does not write anything.
  if (!matrix.verdict.cutoverReady) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

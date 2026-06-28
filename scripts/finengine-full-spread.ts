/**
 * SPEC-FINENGINE-LIVE-SPREAD-1 — Phase 3: live full-spread runner (read-only).
 *
 * Loads each deal's `deal_financial_facts`, runs computeDealSpread (the full
 * library wired to certified snapshots) ALONGSIDE the independent golden-set, and
 * prints the validation (ZERO / INTENDED / UNEXPECTED). Writes NO canonical fact
 * (NG1) — the report docs/finengine/FULL_SPREAD_REPORT.md is authored from this
 * output.
 *
 * Run:  pnpm tsx --conditions=react-server scripts/finengine-full-spread.ts [dealId ...]
 * Required env: SUPABASE_URL (+ a service key) — same as the other scripts.
 */

import process from "node:process";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeDealSpread } from "@/lib/finengine/spread/dealSpread";
import { validateSpread, type IntendedDivergence } from "@/lib/finengine/spread/validateSpread";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

const DEALS = [
  "80fe6f7a-5c68-4f02-8bcf-933f246a9fc5", // OmniCare 365 (primary)
  "dc52c626-fa42-40d3-9b74-7d197ce36bac", // OmniCare Deal Review
  "e62eda2a-e455-408f-b5e6-0228b7b7e8a0", // New Omnicare
  "1d7e7c1b-6237-4f59-a8ba-0eb84dfa0057", // Omnicare 6-18-2026
];

/** Pre-registered immaterial divergence: 2022 pre-tax reconstruction (+$1 federal tax). */
const INTENDED: IntendedDivergence[] = [
  { metric: "EBITDA", period: "2022-12-31", expected: 151226, rationale: "Engine reconstructs a pre-tax base from after-tax NET_INCOME(0) and adds back $1 of 2022 federal income tax; the independent golden uses the M1 pre-tax taxable-income line(0). $1 immaterial source-rounding artifact." },
];

async function loadRows(dealId: string): Promise<CertifiedFactRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await (sb as any)
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num, fact_period_end, owner_type, is_superseded, source_canonical_type, confidence, provenance, source_document_id, created_at")
    .eq("deal_id", dealId)
    .not("fact_value_num", "is", null);
  if (error) throw new Error(`load ${dealId}: ${error.message}`);
  return ((data ?? []) as any[]).map((r) => ({
    fact_key: r.fact_key,
    fact_value_num: r.fact_value_num == null ? null : Number(r.fact_value_num),
    fact_period_end: r.fact_period_end,
    owner_type: r.owner_type,
    is_superseded: !!r.is_superseded,
    source_canonical_type: r.source_canonical_type ?? null,
    confidence: r.confidence == null ? null : Number(r.confidence),
    extractor: r.provenance?.extractor ?? null,
    source_document_id: r.source_document_id ?? null,
    created_at: r.created_at ?? null,
  }));
}

function fmt(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const targets = argv.length ? argv : DEALS;
  console.log(`\n=== finengine FULL-SPREAD live run (read-only) — ${targets.length} deal(s) ===\n`);

  for (const dealId of targets) {
    const rows = await loadRows(dealId);
    if (rows.length === 0) { console.log(`[${dealId.slice(0, 8)}] no facts — skipped.`); continue; }
    const spread = computeDealSpread(dealId, rows);
    const val = validateSpread(spread, { scope: "BUSINESS", intended: INTENDED });
    const bizPeriods = spread.snapshots.filter((s) => s.entityScope === "BUSINESS").map((s) => s.fiscalPeriodEnd);
    console.log(`[${dealId.slice(0, 8)}] rows=${rows.length} cells=${spread.cells.length} bizPeriods=${bizPeriods.length}`);
    console.log(`  validation: ZERO=${val.zero} INTENDED=${val.intended} UNEXPECTED=${val.unexpected} cutoverBlocked=${val.cutoverBlocked}`);
    const ebitda = spread.cells.filter((c) => c.scope === "BUSINESS" && c.metric === "EBITDA").map((c) => `${c.period}=${fmt(c.value)}`);
    console.log(`  business EBITDA: ${ebitda.join("  ")}`);
    for (const u of val.checks.filter((c) => c.classification === "UNEXPECTED")) {
      console.log(`  UNEXPECTED ${u.metric} ${u.period}: engine=${fmt(u.engine)} golden=${fmt(u.golden)} Δ=${fmt(u.absDelta)} — ${u.goldenSource}`);
    }
  }
  console.log(`\n=== done (read-only — no canonical fact written) ===\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });

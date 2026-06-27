/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 0 one-time backfill.
 *
 * Brings the existing `deal_financial_facts` corpus up to the Phase 0 invariants
 * WITHOUT changing any computed value:
 *
 *   1. PROVENANCE  — stamp normalized engine/version/source_quality_rank onto
 *      every row whose provenance lacks an `engine` (V0.2).
 *   2. CONFLICTS   — for every slot (deal_id, fact_key, owner_type,
 *      fact_period_end) with >1 distinct LIVE value, insert a row into
 *      `deal_fact_conflicts` and supersede the losers, picking the single live
 *      winner per §2.3 (strongest source-quality rank; golden-run can never
 *      win; stable tie-break) (V0.1, V0.3).
 *   3. GOLDEN-RUN  — snapshot then DELETE the hardcoded `synthesis:golden_run:*`
 *      and `synthesis:canonical_alias:*` facts (V0.4). OmniCare DSCR becoming
 *      "unresolved/low" until Phase 2 fixes the real C-corp path is EXPECTED.
 *
 * Safety:
 *   - Default mode is DRY-RUN (prints what it would do, writes nothing).
 *   - `--execute` performs the writes. Run AFTER the Phase 0 stamping code has
 *     deployed, so legacy producers don't immediately re-introduce unstamped
 *     rows.
 *   - Golden-run rows are snapshotted to scratch/finengine-phase0-golden-run-
 *     snapshot.json before deletion (reversible).
 *   - Provenance stamping is additive & idempotent; supersession is reversible
 *     (the script logs every flipped id).
 *
 * Run:
 *   DRY-RUN:  pnpm tsx --conditions=react-server scripts/finengine-phase0-backfill.ts
 *   EXECUTE:  pnpm tsx --conditions=react-server scripts/finengine-phase0-backfill.ts --execute
 *
 * Required env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + a service key
 *   (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_KEY / SUPABASE_SERVICE_ROLE).
 */

import process from "node:process";
import { mkdirSync, writeFileSync } from "node:fs";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { stampProvenance } from "@/lib/finengine/provenance";
import {
  detectSlotConflicts,
  buildConflictLedgerRows,
  type FactRow,
} from "@/lib/finengine/conflictLedger";

const EXECUTE = process.argv.includes("--execute");
const SNAPSHOT_PATH = "scratch/finengine-phase0-golden-run-snapshot.json";

function log(...a: unknown[]) {
  console.log(...a);
}

async function loadAllFacts(sb: ReturnType<typeof supabaseAdmin>): Promise<FactRow[]> {
  const rows: FactRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await (sb as any)
      .from("deal_financial_facts")
      .select(
        "id, deal_id, bank_id, fact_type, fact_key, owner_type, owner_entity_id, fact_period_end, fact_value_num, is_superseded, source_canonical_type, created_at, provenance",
      )
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load facts: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as FactRow[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

async function main() {
  const sb = supabaseAdmin();
  log(`\n=== finengine Phase 0 backfill — ${EXECUTE ? "EXECUTE" : "DRY-RUN"} ===\n`);

  const facts = await loadAllFacts(sb);
  log(`Loaded ${facts.length} deal_financial_facts rows.`);

  // ---- 1. PROVENANCE STAMP ------------------------------------------------
  const needStamp = facts.filter((f) => !f.provenance?.engine);
  log(`\n[1] Provenance: ${needStamp.length} rows missing engine → will stamp.`);
  let stamped = 0;
  if (EXECUTE) {
    for (const f of needStamp) {
      const merged = stampProvenance(
        { source_type: "SPREAD", as_of_date: null, ...(f.provenance as any) },
        { sourceCanonicalType: f.source_canonical_type },
      );
      const { error } = await (sb as any)
        .from("deal_financial_facts")
        .update({ provenance: merged })
        .eq("id", f.id);
      if (error) log(`  ! stamp ${f.id}: ${error.message}`);
      else stamped += 1;
    }
    log(`    stamped ${stamped} rows.`);
  } else {
    // Preview the engine distribution that would be written.
    const dist = new Map<string, number>();
    for (const f of needStamp) {
      const merged = stampProvenance(
        { source_type: "SPREAD", as_of_date: null, ...(f.provenance as any) },
        { sourceCanonicalType: f.source_canonical_type },
      );
      dist.set(merged.engine!, (dist.get(merged.engine!) ?? 0) + 1);
    }
    for (const [eng, n] of [...dist.entries()].sort((a, b) => b[1] - a[1])) log(`    ${eng}: ${n}`);
  }

  // ---- 2. CONFLICT LEDGER + SUPERSESSION ----------------------------------
  const conflicts = detectSlotConflicts(facts);
  const ledgerRows = buildConflictLedgerRows(conflicts);
  const loserIds = conflicts.flatMap((c) => c.loserIds);
  log(`\n[2] Conflicts: ${conflicts.length} conflicting slots; ${loserIds.length} losing rows to supersede.`);
  for (const c of conflicts) {
    log(
      `    ${c.factKey} [${c.ownerType} ${c.factPeriodEnd}] deal=${c.dealId.slice(0, 8)} ` +
        `values={${c.candidates.map((x) => `${x.engine}:${x.value}`).join(", ")}} → winner=${c.winnerId?.slice(0, 8) ?? "NONE"}`,
    );
  }
  if (EXECUTE && ledgerRows.length > 0) {
    const { error: insErr } = await (sb as any).from("deal_fact_conflicts").insert(ledgerRows);
    if (insErr) log(`  ! conflict insert: ${insErr.message}`);
    else log(`    inserted ${ledgerRows.length} conflict rows.`);
    for (const id of loserIds) {
      const { error } = await (sb as any)
        .from("deal_financial_facts")
        .update({ is_superseded: true, resolution_status: "superseded_by_conflict_resolution" })
        .eq("id", id);
      if (error) log(`  ! supersede ${id}: ${error.message}`);
    }
    log(`    superseded ${loserIds.length} losing rows.`);
  }

  // ---- 3. GOLDEN-RUN SNAPSHOT + DELETE ------------------------------------
  const goldenRows = facts.filter((f) => {
    const ref = f.provenance?.source_ref ?? "";
    return /^synthesis:golden_run:/.test(ref) || /^synthesis:canonical_alias:/.test(ref);
  });
  log(`\n[3] Golden-run: ${goldenRows.length} hardcoded synthesis rows to snapshot + delete.`);
  if (EXECUTE && goldenRows.length > 0) {
    mkdirSync("scratch", { recursive: true });
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(goldenRows, null, 2));
    log(`    snapshot → ${SNAPSHOT_PATH}`);
    for (const f of goldenRows) {
      const { error } = await (sb as any).from("deal_financial_facts").delete().eq("id", f.id);
      if (error) log(`  ! delete ${f.id}: ${error.message}`);
    }
    log(`    deleted ${goldenRows.length} golden-run rows.`);
  }

  log(`\n=== done (${EXECUTE ? "EXECUTE" : "DRY-RUN — no writes"}) ===\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * SPEC-FINENGINE-DECISION-CORE-SHADOW-1 §3 — decision-core shadow runner (read-only).
 *
 * Runs the finengine global cash flow + stress engine on a real deal and prints the
 * finengine global DSCR + stressed DSCR vs the legacy `DSCR` / `DSCR_STRESSED_300BPS`,
 * the gated `ShadowReport` (ZERO/INTENDED/UNEXPECTED + cutoverBlocked), and all
 * warnings. With the empty golden default the corrected global denominator makes the
 * DSCR diverge → UNEXPECTED (the gate working; the companion golden spec registers it
 * as INTENDED).
 *
 * Writes NO canonical fact (NG1) — console only.
 *
 * Run:  pnpm tsx --conditions=react-server scripts/finengine-decision-core-shadow.ts [dealId ...]
 * Default deal: OmniCare. Pass Samaritus (0279ed32-…) for a second shape.
 * Required env: SUPABASE_URL (+ a service key).
 */

import process from "node:process";
import { runDecisionCoreShadow } from "@/lib/finengine/shadow/runDecisionCoreShadow";
import { loadCertifiedRows } from "./_loadCertifiedRows";

const OMNICARE = "eefd62b3-4ae2-4d43-bb80-9953fdca9bcc";
const dealIds = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const targets = dealIds.length > 0 ? dealIds : [OMNICARE];

function fmt(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

async function main() {
  console.log(`\n=== finengine DECISION-CORE shadow run (read-only) — ${targets.length} deal(s) ===\n`);
  for (const dealId of targets) {
    const rows = await loadCertifiedRows(dealId);
    if (rows.length === 0) {
      console.log(`[${dealId.slice(0, 8)}] no facts on file — skipped.`);
      continue;
    }

    const { analysisPeriod, analysisPeriodBasis, globalDSCR, stressedDSCR, report, warnings } = runDecisionCoreShadow(dealId, rows);
    console.log(`[${dealId.slice(0, 8)}] analysisPeriod=${analysisPeriod} (${analysisPeriodBasis})`);

    console.log(`\n  ── finengine decision numbers ──`);
    console.log(`     globalDSCR=${fmt(globalDSCR)}   stressedDSCR(+300bps)=${fmt(stressedDSCR)}`);

    console.log(`\n  ── GATED diff vs legacy (DECISION_CORE_OVERLAPPING) ──`);
    console.log(`     total=${report.total} ZERO=${report.zero} INTENDED=${report.intended} UNEXPECTED=${report.unexpected}  cutoverBlocked=${report.cutoverBlocked}`);
    for (const key of ["DSCR", "DSCR_STRESSED_300BPS"]) {
      const ds = report.divergences.filter((d) => d.factKey === key);
      if (ds.length === 0) continue;
      const z = ds.filter((d) => d.classification === "ZERO").length;
      const i = ds.filter((d) => d.classification === "INTENDED").length;
      const u = ds.filter((d) => d.classification === "UNEXPECTED").length;
      console.log(`     ${key}: ZERO=${z} INTENDED=${i} UNEXPECTED=${u}`);
    }
    for (const d of report.divergences) {
      console.log(
        `     ${d.classification.padEnd(10)} ${d.factKey} ${d.fiscalPeriodEnd} [${d.ownerType}]  ` +
          `legacy=${fmt(d.legacyValue)} finengine=${fmt(d.newValue)}` +
          (d.note ? `  (${d.note})` : ""),
      );
    }
    if (report.divergences.length === 0) console.log(`     (no legacy decision facts to gate against)`);

    if (warnings.length) {
      console.log(`\n  ⚠ warnings (${warnings.length}):`);
      for (const w of warnings) console.log(`     - ${w}`);
    }
    console.log("");
  }
  console.log(`=== done (read-only — no canonical fact written) ===\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

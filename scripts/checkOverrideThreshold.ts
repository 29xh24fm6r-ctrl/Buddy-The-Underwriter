/**
 * CI Override Threshold Check
 *
 * Warns when override clusters accumulate past a threshold, signaling the
 * golden corpus needs expansion.
 *
 * READ-ONLY — no modifications to rules, data, or test files.
 *
 * Exit codes:
 *   0  — OK or warn (below fail threshold)
 *   1  — Fail (cluster count exceeds fail threshold)
 *
 * Usage:
 *   npx tsx scripts/checkOverrideThreshold.ts
 *   npx tsx scripts/checkOverrideThreshold.ts --warn 10 --fail 25
 *   npx tsx scripts/checkOverrideThreshold.ts --help
 *
 * Required env vars (at least one URL + service role key):
 *   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

// ── CLI arg parsing ─────────────────────────────────────────────────────────

interface CliArgs {
  warn: number;
  fail: number;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let warn = 10;
  let fail = 25;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help" || argv[i] === "-h") {
      help = true;
    } else if (argv[i] === "--warn") {
      const val = parseInt(argv[i + 1] ?? "", 10);
      if (!isNaN(val) && val > 0) {
        warn = val;
        i++;
      } else {
        console.error(`[checkOverrideThreshold] Invalid --warn value: ${argv[i + 1]}`);
        process.exit(1);
      }
    } else if (argv[i] === "--fail") {
      const val = parseInt(argv[i + 1] ?? "", 10);
      if (!isNaN(val) && val > 0) {
        fail = val;
        i++;
      } else {
        console.error(`[checkOverrideThreshold] Invalid --fail value: ${argv[i + 1]}`);
        process.exit(1);
      }
    }
  }

  return { warn, fail, help };
}

function printHelp(): void {
  console.log(`
CI Override Threshold Check
=============================
Queries deal_events + deal_pipeline_ledger for manual override events,
counts distinct confusion pairs with >= 5 occurrences, and checks
against warn/fail thresholds.

READ-ONLY — never modifies any rules, data, or test files.

Exit codes:
  0  — OK or warn (below fail threshold)
  1  — Fail (cluster count exceeds fail threshold)

Usage:
  npx tsx scripts/checkOverrideThreshold.ts [options]

Options:
  --warn N   Warn threshold for distinct cluster count (default: 10)
  --fail N   Fail threshold for distinct cluster count (default: 25)
  --help     Show this help text

Required env vars:
  SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
  SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE)
`);
}

// ── Types ───────────────────────────────────────────────────────────────────

interface NormalisedPair {
  fromType: string;
  toType: string;
}

// ── Normalisation helpers ───────────────────────────────────────────────────

/**
 * Normalise a deal_events row payload into a confusion pair.
 * See generateGoldenFromOverrides.ts for shape documentation.
 */
function normaliseDealEventPayload(payload: Record<string, any> | null): NormalisedPair | null {
  if (!payload || typeof payload !== "object") return null;

  // Shape A: previous/new sub-objects
  if (payload.previous !== undefined || payload.new !== undefined) {
    const prev = (payload.previous as Record<string, any>) ?? {};
    const next = (payload.new as Record<string, any>) ?? {};
    const fromType = (prev.document_type as string | undefined) ?? null;
    const toType = (next.document_type as string | undefined) ?? null;
    if (fromType && toType && fromType !== toType) {
      return { fromType, toType };
    }
    return null;
  }

  // Shape B: flat original_type / meta.corrected_type
  if (payload.original_type !== undefined) {
    const fromType = (payload.original_type as string | undefined) ?? null;
    const meta = (payload.meta as Record<string, any>) ?? {};
    const toType = (meta.corrected_type as string | undefined) ?? (payload.corrected_type as string | undefined) ?? null;
    if (fromType && toType && fromType !== toType) {
      return { fromType, toType };
    }
    return null;
  }

  return null;
}

/**
 * Normalise a deal_pipeline_ledger row meta into a confusion pair.
 */
function normaliseLedgerMeta(meta: Record<string, any> | null): NormalisedPair | null {
  if (!meta || typeof meta !== "object") return null;

  // Shape A: previous/new sub-objects
  if (meta.previous !== undefined || meta.new !== undefined) {
    const prev = (meta.previous as Record<string, any>) ?? {};
    const next = (meta.new as Record<string, any>) ?? {};
    const fromType = (prev.document_type as string | undefined) ?? null;
    const toType = (next.document_type as string | undefined) ?? null;
    if (fromType && toType && fromType !== toType) {
      return { fromType, toType };
    }
    return null;
  }

  // Shape B: flat original_type / corrected_type
  if (meta.original_type !== undefined) {
    const fromType = (meta.original_type as string | undefined) ?? null;
    const toType = (meta.corrected_type as string | undefined) ?? null;
    if (fromType && toType && fromType !== toType) {
      return { fromType, toType };
    }
    return null;
  }

  return null;
}

// ── Data fetching ───────────────────────────────────────────────────────────

const PAGE_SIZE = 1000;

/** Minimum occurrences for a confusion pair to count as a "cluster". */
const CLUSTER_MIN_COUNT = 5;

async function fetchDealEventPairs(): Promise<NormalisedPair[]> {
  const sb = supabaseAdmin();
  const pairs: NormalisedPair[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await sb
      .from("deal_events")
      .select("id, deal_id, kind, payload, created_at")
      .eq("kind", "classification.manual_override")
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error(`[checkOverrideThreshold] deal_events query failed: ${error.message}`);
      break;
    }

    if (!data || data.length === 0) break;

    for (const row of data) {
      const pair = normaliseDealEventPayload(row.payload);
      if (pair) pairs.push(pair);
    }

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return pairs;
}

async function fetchLedgerPairs(): Promise<NormalisedPair[]> {
  const sb = supabaseAdmin();
  const pairs: NormalisedPair[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await sb
      .from("deal_pipeline_ledger")
      .select("id, deal_id, event_key, created_at, meta")
      .like("event_key", "%.manual_override")
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error(`[checkOverrideThreshold] deal_pipeline_ledger query failed: ${error.message}`);
      break;
    }

    if (!data || data.length === 0) break;

    for (const row of data) {
      const pair = normaliseLedgerMeta(row.meta);
      if (pair) pairs.push(pair);
    }

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return pairs;
}

// ── Clustering ──────────────────────────────────────────────────────────────

function countSignificantClusters(pairs: NormalisedPair[]): {
  totalPairs: number;
  significantClusters: number;
  topClusters: Array<{ fromType: string; toType: string; count: number }>;
} {
  const map = new Map<string, { fromType: string; toType: string; count: number }>();

  for (const { fromType, toType } of pairs) {
    const key = `${fromType} -> ${toType}`;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
    } else {
      map.set(key, { fromType, toType, count: 1 });
    }
  }

  const allClusters = Array.from(map.values()).sort((a, b) => b.count - a.count);
  const significant = allClusters.filter((c) => c.count >= CLUSTER_MIN_COUNT);

  return {
    totalPairs: pairs.length,
    significantClusters: significant.length,
    topClusters: significant.slice(0, 10),
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  console.log(`[checkOverrideThreshold] Querying override events...`);
  console.log(`[checkOverrideThreshold] Thresholds: warn=${args.warn}, fail=${args.fail}`);

  // Fetch from both sources
  const [dealEventPairs, ledgerPairs] = await Promise.all([
    fetchDealEventPairs(),
    fetchLedgerPairs(),
  ]);

  const allPairs = [...dealEventPairs, ...ledgerPairs];

  console.log(`[checkOverrideThreshold] Total override events: ${allPairs.length} (deal_events: ${dealEventPairs.length}, ledger: ${ledgerPairs.length})`);

  if (allPairs.length === 0) {
    console.log(`[checkOverrideThreshold] 0 clusters found — no overrides in database.`);
    console.log(`[checkOverrideThreshold] OK`);
    process.exit(0);
  }

  const { significantClusters, topClusters } = countSignificantClusters(allPairs);

  console.log(`[checkOverrideThreshold] Distinct confusion pairs with >= ${CLUSTER_MIN_COUNT} occurrences: ${significantClusters}`);

  if (topClusters.length > 0) {
    console.log(`\nTop clusters:`);
    for (const c of topClusters) {
      console.log(`  ${c.fromType} -> ${c.toType}: ${c.count} overrides`);
    }
    console.log("");
  }

  // Evaluate thresholds
  if (significantClusters >= args.fail) {
    console.log(`[checkOverrideThreshold] FAIL: ${significantClusters} clusters >= fail threshold (${args.fail})`);
    console.log(`[checkOverrideThreshold] The golden corpus needs expansion. Run:`);
    console.log(`  npx tsx scripts/generateGoldenFromOverrides.ts`);
    process.exit(1);
  }

  if (significantClusters >= args.warn) {
    console.log(`[checkOverrideThreshold] WARNING: ${significantClusters} clusters >= warn threshold (${args.warn})`);
    console.log(`[checkOverrideThreshold] Consider expanding the golden corpus. Run:`);
    console.log(`  npx tsx scripts/generateGoldenFromOverrides.ts`);
    process.exit(0);
  }

  console.log(`[checkOverrideThreshold] OK: ${significantClusters} clusters below warn threshold (${args.warn})`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error("\n[checkOverrideThreshold] FATAL:", (e as any)?.message ?? e);
  process.exit(1);
});

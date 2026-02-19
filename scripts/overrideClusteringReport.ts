/**
 * Override Clustering Report
 *
 * Queries deal_events + deal_pipeline_ledger for manual override events and
 * produces:
 *   1. Top confusion pairs   (from_type → to_type)
 *   2. Top slot misroutes    (from_slot → to_slot)
 *   3. Top missing identity signals (original type where no signal was present)
 *
 * READ-ONLY — no modifications to rules or data.
 *
 * Usage:
 *   npx tsx scripts/overrideClusteringReport.ts
 *   npx tsx scripts/overrideClusteringReport.ts --limit 20
 *   npx tsx scripts/overrideClusteringReport.ts --help
 *
 * Required env vars (at least one URL + service role key):
 *   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

// ─── CLI arg parsing ─────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { limit: number; help: boolean } {
  let limit = 10;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help" || argv[i] === "-h") {
      help = true;
    } else if (argv[i] === "--limit" || argv[i] === "-n") {
      const val = parseInt(argv[i + 1] ?? "", 10);
      if (!isNaN(val) && val > 0) {
        limit = val;
        i++;
      } else {
        console.error(`[overrideClusteringReport] Invalid --limit value: ${argv[i + 1]}`);
        process.exit(1);
      }
    }
  }

  return { limit, help };
}

function printHelp(): void {
  console.log(`
Override Clustering Report
==========================
Queries deal_events + deal_pipeline_ledger for manual override events and
surfaces the top confusion patterns, slot misroutes, and missing identity
signals.

READ-ONLY — never modifies any rules or data.

Usage:
  npx tsx scripts/overrideClusteringReport.ts [options]

Options:
  --limit N   Number of top entries to show per section (default: 10)
  --help      Show this help text

Output:
  Console table + JSON report printed to stdout.

Required env vars:
  SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
  SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE)
`);
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface LedgerRow {
  id: string;
  deal_id: string;
  bank_id: string | null;
  event_key: string;
  created_at: string;
  meta: Record<string, any> | null;
}

interface DealEventRow {
  id: string;
  deal_id: string;
  kind: string;
  payload: Record<string, any> | null;
  created_at: string;
}

interface ConfusionPair {
  from_type: string;
  to_type: string;
  count: number;
}

interface SlotMisroute {
  from_slot: string;
  to_slot: string;
  count: number;
}

interface MissingSignal {
  original_type: string;
  count: number;
}

interface OverrideReport {
  generated_at: string;
  total_override_events: number;
  limit: number;
  confusion_pairs: ConfusionPair[];
  slot_misroutes: SlotMisroute[];
  missing_identity_signals: MissingSignal[];
}

// ─── Aggregation helpers ─────────────────────────────────────────────────────

function increment<K extends string>(
  map: Map<K, number>,
  key: K
): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function topN<T>(entries: [string, number][], limit: number, parse: (key: string, count: number) => T): T[] {
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => parse(key, count));
}

// ─── Meta extraction ─────────────────────────────────────────────────────────

/**
 * For document.manual_override events, meta shape is:
 *   {
 *     previous: { checklist_key, document_type, doc_year },
 *     new:      { checklist_key, document_type, doc_year },
 *     filename, document_id, classified_by
 *   }
 *
 * For classification.manual_override events (stored via writeEvent to deal_events
 * but some may also land in the ledger), meta shape may be:
 *   {
 *     original_type, corrected_type, corrected_checklist_key, ...
 *   }
 *
 * This function normalises both shapes into a single structure.
 */
interface NormalisedOverride {
  fromType: string | null;
  toType: string | null;
  fromSlot: string | null;
  toSlot: string | null;
  /** True when from_type is null or empty — signals were missing at classify time */
  hadMissingSignal: boolean;
}

function normaliseMetaForRow(row: LedgerRow): NormalisedOverride | null {
  const meta = row.meta;
  if (!meta || typeof meta !== "object") return null;

  // Shape 1: document.manual_override — uses previous/new sub-objects
  if (meta.previous !== undefined || meta.new !== undefined) {
    const prev = (meta.previous as Record<string, any>) ?? {};
    const next = (meta.new as Record<string, any>) ?? {};

    const fromType = (prev.document_type as string | null | undefined) ?? null;
    const toType = (next.document_type as string | null | undefined) ?? null;
    const fromSlot = (prev.checklist_key as string | null | undefined) ?? null;
    const toSlot = (next.checklist_key as string | null | undefined) ?? null;

    const hadMissingSignal = !fromType || fromType.trim() === "";

    return { fromType, toType, fromSlot, toSlot, hadMissingSignal };
  }

  // Shape 2: classification.manual_override — flat fields
  if (meta.original_type !== undefined || meta.corrected_type !== undefined) {
    const fromType = (meta.original_type as string | null | undefined) ?? null;
    const toType = (meta.corrected_type as string | null | undefined) ?? null;
    const fromSlot: string | null = null; // not present in this shape
    const toSlot = (meta.corrected_checklist_key as string | null | undefined) ?? null;

    const hadMissingSignal = !fromType || fromType.trim() === "";

    return { fromType, toType, fromSlot, toSlot, hadMissingSignal };
  }

  return null;
}

/**
 * Normalise a deal_events row (payload column) into a NormalisedOverride.
 *
 * deal_events uses `payload` (jsonb) with two shapes:
 *   Shape A: payload.previous.document_type / payload.new.document_type
 *   Shape B: payload.original_type / payload.meta.corrected_type
 */
function normalisePayloadForDealEvent(row: DealEventRow): NormalisedOverride | null {
  const payload = row.payload;
  if (!payload || typeof payload !== "object") return null;

  // Shape A: previous/new sub-objects
  if (payload.previous !== undefined || payload.new !== undefined) {
    const prev = (payload.previous as Record<string, any>) ?? {};
    const next = (payload.new as Record<string, any>) ?? {};

    const fromType = (prev.document_type as string | null | undefined) ?? null;
    const toType = (next.document_type as string | null | undefined) ?? null;
    const fromSlot = (prev.checklist_key as string | null | undefined) ?? null;
    const toSlot = (next.checklist_key as string | null | undefined) ?? null;

    const hadMissingSignal = !fromType || fromType.trim() === "";

    return { fromType, toType, fromSlot, toSlot, hadMissingSignal };
  }

  // Shape B: flat original_type / meta.corrected_type
  if (payload.original_type !== undefined) {
    const fromType = (payload.original_type as string | null | undefined) ?? null;
    const meta = (payload.meta as Record<string, any>) ?? {};
    const toType = (meta.corrected_type as string | null | undefined) ?? (payload.corrected_type as string | null | undefined) ?? null;
    const fromSlot: string | null = null;
    const toSlot = (meta.corrected_checklist_key as string | null | undefined) ?? null;

    const hadMissingSignal = !fromType || fromType.trim() === "";

    return { fromType, toType, fromSlot, toSlot, hadMissingSignal };
  }

  return null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function run(limit: number): Promise<OverrideReport> {
  const sb = supabaseAdmin();
  const PAGE_SIZE = 1000;

  // ── 1. Fetch from deal_pipeline_ledger (legacy) ──────────────────────────
  const ledgerRows: LedgerRow[] = [];
  {
    let offset = 0;
    while (true) {
      const { data, error } = await sb
        .from("deal_pipeline_ledger")
        .select("id, deal_id, bank_id, event_key, created_at, meta")
        .like("event_key", "%.manual_override")
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        console.error(`[overrideClusteringReport] deal_pipeline_ledger query failed: ${error.message}`);
        break;
      }

      if (!data || data.length === 0) break;

      ledgerRows.push(...(data as LedgerRow[]));

      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  // ── 2. Fetch from deal_events (canonical) ────────────────────────────────
  const eventRows: DealEventRow[] = [];
  {
    let offset = 0;
    while (true) {
      const { data, error } = await sb
        .from("deal_events")
        .select("id, deal_id, kind, payload, created_at")
        .eq("kind", "classification.manual_override")
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        console.error(`[overrideClusteringReport] deal_events query failed: ${error.message}`);
        break;
      }

      if (!data || data.length === 0) break;

      eventRows.push(...(data as DealEventRow[]));

      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  // ── 3. Normalise + deduplicate ───────────────────────────────────────────
  // Dedup key: deal_id + created_at (in case events appear in both tables)
  const seen = new Set<string>();
  const allNormalised: NormalisedOverride[] = [];

  for (const row of ledgerRows) {
    const dedup = `${row.deal_id}|${row.created_at}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    const norm = normaliseMetaForRow(row);
    if (norm) allNormalised.push(norm);
  }

  for (const row of eventRows) {
    const dedup = `${row.deal_id}|${row.created_at}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    const norm = normalisePayloadForDealEvent(row);
    if (norm) allNormalised.push(norm);
  }

  // Aggregation maps
  const confusionMap = new Map<string, number>();
  const slotMap = new Map<string, number>();
  const missingSignalMap = new Map<string, number>();

  for (const norm of allNormalised) {
    // ── Confusion pairs (from_type → to_type) ──────────────────────────────
    if (norm.fromType && norm.toType && norm.fromType !== norm.toType) {
      const pairKey = `${norm.fromType} → ${norm.toType}`;
      increment(confusionMap, pairKey);
    }

    // ── Slot misroutes (from_slot → to_slot) ───────────────────────────────
    if (norm.fromSlot && norm.toSlot && norm.fromSlot !== norm.toSlot) {
      const slotKey = `${norm.fromSlot} → ${norm.toSlot}`;
      increment(slotMap, slotKey);
    }

    // ── Missing identity signals ────────────────────────────────────────────
    if (norm.hadMissingSignal) {
      // Use "unclassified" as the label when the type was truly absent
      const label = norm.fromType && norm.fromType.trim() ? norm.fromType : "unclassified";
      increment(missingSignalMap, label);
    }
  }

  // Build sorted top-N sections
  const confusionPairs = topN(
    Array.from(confusionMap.entries()),
    limit,
    (key, count) => {
      const parts = key.split(" → ");
      return { from_type: parts[0] ?? key, to_type: parts[1] ?? "", count };
    }
  );

  const slotMisroutes = topN(
    Array.from(slotMap.entries()),
    limit,
    (key, count) => {
      const parts = key.split(" → ");
      return { from_slot: parts[0] ?? key, to_slot: parts[1] ?? "", count };
    }
  );

  const missingIdentitySignals = topN(
    Array.from(missingSignalMap.entries()),
    limit,
    (key, count) => ({ original_type: key, count })
  );

  return {
    generated_at: new Date().toISOString(),
    total_override_events: allNormalised.length,
    limit,
    confusion_pairs: confusionPairs,
    slot_misroutes: slotMisroutes,
    missing_identity_signals: missingIdentitySignals,
  };
}

// ─── Console table printer ───────────────────────────────────────────────────

function printTable(title: string, headers: string[], rows: string[][]): void {
  if (rows.length === 0) {
    console.log(`\n${title}\n  (no data)\n`);
    return;
  }

  // Calculate column widths
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
  );

  const divider = colWidths.map((w) => "-".repeat(w)).join("-+-");
  const headerRow = headers.map((h, i) => h.padEnd(colWidths[i]!)).join(" | ");

  console.log(`\n${title}`);
  console.log(headerRow);
  console.log(divider);
  for (const row of rows) {
    console.log(row.map((cell, i) => cell.padEnd(colWidths[i]!)).join(" | "));
  }
  console.log("");
}

function printReport(report: OverrideReport): void {
  console.log("=".repeat(60));
  console.log("  Override Clustering Report");
  console.log("=".repeat(60));
  console.log(`  Generated:            ${report.generated_at}`);
  console.log(`  Total override events: ${report.total_override_events}`);
  console.log(`  Top N limit:          ${report.limit}`);
  console.log("=".repeat(60));

  // Section 1: Confusion pairs
  printTable(
    `[1] Top Confusion Pairs (from_type → to_type)  [top ${report.limit}]`,
    ["#", "From Type", "To Type", "Count"],
    report.confusion_pairs.map((r, i) => [
      String(i + 1),
      r.from_type,
      r.to_type,
      String(r.count),
    ])
  );

  // Section 2: Slot misroutes
  printTable(
    `[2] Top Slot Misroutes (from_slot → to_slot)  [top ${report.limit}]`,
    ["#", "From Slot", "To Slot", "Count"],
    report.slot_misroutes.map((r, i) => [
      String(i + 1),
      r.from_slot,
      r.to_slot,
      String(r.count),
    ])
  );

  // Section 3: Missing identity signals
  printTable(
    `[3] Top Missing Identity Signals  [top ${report.limit}]`,
    ["#", "Original Type", "Override Count"],
    report.missing_identity_signals.map((r, i) => [
      String(i + 1),
      r.original_type,
      String(r.count),
    ])
  );
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  console.log(`[overrideClusteringReport] Querying deal_events + deal_pipeline_ledger for manual override events...`);

  const report = await run(args.limit);

  printReport(report);

  // JSON output to stdout (machine-readable)
  console.log("\n--- JSON REPORT ---");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e: unknown) => {
  console.error("\n[overrideClusteringReport] FATAL:", (e as any)?.message ?? e);
  process.exit(1);
});

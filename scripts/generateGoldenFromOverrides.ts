/**
 * Golden Corpus Stub Generator
 *
 * Queries override clusters from deal_events + deal_pipeline_ledger and
 * generates golden test stubs that FAIL (test.skip) by default, forcing
 * humans to add deterministic rules before they pass.
 *
 * READ-ONLY — output to stdout ONLY.
 * Cannot write test files, auto-commit, auto-bump, auto-create PRs,
 * or modify negativeRules.ts / constraints.ts / any engine file.
 *
 * Usage:
 *   npx tsx scripts/generateGoldenFromOverrides.ts
 *   npx tsx scripts/generateGoldenFromOverrides.ts --limit 20 --min-count 5
 *   npx tsx scripts/generateGoldenFromOverrides.ts --help
 *   # Save to file:
 *   npx tsx scripts/generateGoldenFromOverrides.ts > src/lib/intake/matching/__tests__/golden_generated.test.ts
 *
 * Required env vars (at least one URL + service role key):
 *   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

// ── CLI arg parsing ─────────────────────────────────────────────────────────

interface CliArgs {
  limit: number;
  minCount: number;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let limit = 10;
  let minCount = 3;
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
        console.error(`[generateGoldenFromOverrides] Invalid --limit value: ${argv[i + 1]}`);
        process.exit(1);
      }
    } else if (argv[i] === "--min-count") {
      const val = parseInt(argv[i + 1] ?? "", 10);
      if (!isNaN(val) && val > 0) {
        minCount = val;
        i++;
      } else {
        console.error(`[generateGoldenFromOverrides] Invalid --min-count value: ${argv[i + 1]}`);
        process.exit(1);
      }
    }
  }

  return { limit, minCount, help };
}

function printHelp(): void {
  console.log(`
Golden Corpus Stub Generator
==============================
Queries deal_events + deal_pipeline_ledger for manual override events,
clusters them by confusion pair (fromType -> toType), and generates
golden test stubs that FAIL by default (test.skip).

READ-ONLY — output goes to stdout ONLY.
Buddy never self-modifies. Humans remain in loop.

Usage:
  npx tsx scripts/generateGoldenFromOverrides.ts [options]

Options:
  --limit N       Number of top confusion pairs to emit (default: 10)
  --min-count N   Minimum override occurrences to include a pair (default: 3)
  --help          Show this help text

Output:
  A complete TypeScript test file with test.skip() stubs is printed to stdout.
  Redirect to save:
    npx tsx scripts/generateGoldenFromOverrides.ts > path/to/golden_generated.test.ts

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

interface ConfusionCluster {
  fromType: string;
  toType: string;
  count: number;
}

// ── Normalisation helpers ───────────────────────────────────────────────────

/**
 * Normalise a deal_events row payload into a confusion pair.
 *
 * Handles two payload shapes:
 *   Shape A (document.manual_override):
 *     payload.previous.document_type -> payload.new.document_type
 *   Shape B (classification.manual_override):
 *     payload.original_type -> payload.meta.corrected_type
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
 * Same two shapes as deal_events but top-level key is `meta` instead of `payload`.
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

async function fetchDealEventOverrides(): Promise<NormalisedPair[]> {
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
      console.error(`[generateGoldenFromOverrides] deal_events query failed: ${error.message}`);
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

async function fetchLedgerOverrides(): Promise<NormalisedPair[]> {
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
      console.error(`[generateGoldenFromOverrides] deal_pipeline_ledger query failed: ${error.message}`);
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

function clusterPairs(pairs: NormalisedPair[], minCount: number, limit: number): ConfusionCluster[] {
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

  return Array.from(map.values())
    .filter((c) => c.count >= minCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ── Stub generation ─────────────────────────────────────────────────────────

/**
 * Convert a doc type string to a plausible slot ID fragment.
 * E.g. "BUSINESS_TAX_RETURN" -> "btr", "INCOME_STATEMENT" -> "is"
 */
function docTypeToSlotHint(docType: string): string {
  // Common abbreviations
  const abbrevMap: Record<string, string> = {
    BUSINESS_TAX_RETURN: "btr",
    PERSONAL_TAX_RETURN: "ptr",
    PERSONAL_FINANCIAL_STATEMENT: "pfs",
    INCOME_STATEMENT: "is",
    BALANCE_SHEET: "bs",
    RENT_ROLL: "rr",
    FINANCIAL_STATEMENT: "fs",
    PFS: "pfs",
    TAX_RETURN: "tr",
  };

  if (abbrevMap[docType]) return abbrevMap[docType]!;

  // Fallback: take first letters of each word
  return docType
    .toLowerCase()
    .split("_")
    .map((w) => w[0] ?? "")
    .join("");
}

function generateFileHeader(): string {
  const now = new Date().toISOString();
  return `/**
 * Golden Corpus — Auto-Generated Override Stubs
 *
 * Generated at: ${now}
 * Source: deal_events + deal_pipeline_ledger override clusters
 *
 * IMPORTANT: Every test below is test.skip() — it will NOT run until a human
 * adds the corresponding deterministic rule and removes the .skip.
 *
 * Buddy never self-modifies. Humans remain in loop.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { matchDocumentToSlot } from "../matchEngine";
import type { DocumentIdentity, SlotSnapshot } from "../types";

// ---------------------------------------------------------------------------
// Identity builder
// ---------------------------------------------------------------------------

function makeIdentity(overrides: Partial<DocumentIdentity>): DocumentIdentity {
  return {
    documentId: "golden-gen-doc",
    effectiveDocType: "OTHER",
    rawDocType: "OTHER",
    taxYear: null,
    entityType: null,
    formNumbers: null,
    authority: "deterministic",
    confidence: 0.97,
    classificationEvidence: [
      { type: "form_match", anchorId: "golden-gen", matchedText: "test", confidence: 0.97 },
    ],
    period: null,
    entity: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Slot builder
// ---------------------------------------------------------------------------

function makeSlot(
  overrides: Partial<SlotSnapshot> & Pick<SlotSnapshot, "slotId" | "slotKey" | "requiredDocType">,
): SlotSnapshot {
  return {
    slotGroup: "default",
    requiredTaxYear: null,
    status: "empty",
    sortOrder: 0,
    ...overrides,
  };
}

function goldenSlots(): SlotSnapshot[] {
  return [
    makeSlot({ slotId: "btr-2024", slotKey: "BTR_2024", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 1 }),
    makeSlot({ slotId: "btr-2023", slotKey: "BTR_2023", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2023, slotGroup: "tax", sortOrder: 2 }),
    makeSlot({ slotId: "btr-2022", slotKey: "BTR_2022", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2022, slotGroup: "tax", sortOrder: 3 }),
    makeSlot({ slotId: "ptr-2024", slotKey: "PTR_2024", requiredDocType: "PERSONAL_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 4 }),
    makeSlot({ slotId: "ptr-2023", slotKey: "PTR_2023", requiredDocType: "PERSONAL_TAX_RETURN", requiredTaxYear: 2023, slotGroup: "tax", sortOrder: 5 }),
    makeSlot({ slotId: "ptr-2022", slotKey: "PTR_2022", requiredDocType: "PERSONAL_TAX_RETURN", requiredTaxYear: 2022, slotGroup: "tax", sortOrder: 6 }),
    makeSlot({ slotId: "pfs-1", slotKey: "PFS_CURRENT", requiredDocType: "PERSONAL_FINANCIAL_STATEMENT", slotGroup: "financial", sortOrder: 7 }),
    makeSlot({ slotId: "is-1", slotKey: "IS_YTD", requiredDocType: "INCOME_STATEMENT", slotGroup: "financial", sortOrder: 8 }),
    makeSlot({ slotId: "bs-1", slotKey: "BS_YTD", requiredDocType: "BALANCE_SHEET", slotGroup: "financial", sortOrder: 9 }),
    makeSlot({ slotId: "rr-1", slotKey: "RENT_ROLL", requiredDocType: "RENT_ROLL", slotGroup: "property", sortOrder: 10 }),
  ];
}

// ---------------------------------------------------------------------------
// Generated override stubs — test.skip() until rules are added
// ---------------------------------------------------------------------------
`;
}

function generateStub(cluster: ConfusionCluster, index: number): string {
  const { fromType, toType, count } = cluster;
  const wrongSlotHint = `${docTypeToSlotHint(toType)}-1`;

  return `
// Generated stub for confusion pair: ${fromType} -> ${toType} (N=${count})
// Override cluster detected — ${count} bankers corrected this classification.
// TODO: Add deterministic rule to handle this case, then remove .skip
test.skip("Golden #gen-${index}: ${fromType} should NOT auto-attach to ${toType} slot", () => {
  const result = matchDocumentToSlot(
    makeIdentity({
      effectiveDocType: "${fromType}",
      rawDocType: "${fromType}",
      taxYear: null,
      entityType: null,
      confidence: 0.92,
    }),
    goldenSlots(),
  );
  // STUB: This test is SKIPPED until a rule is added.
  // The override cluster shows ${count} bankers corrected this classification.
  assert.notEqual(result.slotId, "${wrongSlotHint}",
    "${fromType} must NOT auto-attach to ${toType} slot");
});`;
}

function generateFooter(totalClusters: number): string {
  return `

// ── CI Invariant ────────────────────────────────────────────────────────────
// Total override clusters emitted: ${totalClusters}
// Every stub above is test.skip() — it will NOT break CI.
// To activate: add the deterministic rule, remove .skip, verify green.
// Buddy never self-modifies. Humans remain in loop.
`;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  console.error(`[generateGoldenFromOverrides] Querying override events...`);
  console.error(`[generateGoldenFromOverrides] Options: limit=${args.limit}, min-count=${args.minCount}`);

  // Fetch from both sources
  const [dealEventPairs, ledgerPairs] = await Promise.all([
    fetchDealEventOverrides(),
    fetchLedgerOverrides(),
  ]);

  console.error(`[generateGoldenFromOverrides] Found ${dealEventPairs.length} pairs from deal_events`);
  console.error(`[generateGoldenFromOverrides] Found ${ledgerPairs.length} pairs from deal_pipeline_ledger`);

  // Merge all pairs
  const allPairs = [...dealEventPairs, ...ledgerPairs];

  if (allPairs.length === 0) {
    console.error(`[generateGoldenFromOverrides] 0 clusters found — no overrides in database.`);
    // Still output a valid (empty) test file
    console.log(generateFileHeader());
    console.log(generateFooter(0));
    process.exit(0);
  }

  // Cluster and filter
  const clusters = clusterPairs(allPairs, args.minCount, args.limit);

  console.error(`[generateGoldenFromOverrides] ${clusters.length} clusters above min-count threshold`);

  // Output the complete test file to stdout
  console.log(generateFileHeader());

  for (let i = 0; i < clusters.length; i++) {
    console.log(generateStub(clusters[i]!, i + 1));
  }

  console.log(generateFooter(clusters.length));
}

main().catch((e: unknown) => {
  console.error("\n[generateGoldenFromOverrides] FATAL:", (e as any)?.message ?? e);
  process.exit(1);
});

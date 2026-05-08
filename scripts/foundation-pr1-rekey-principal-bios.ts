#!/usr/bin/env -S pnpm tsx
/**
 * SPEC-FOUNDATION-V1 PR1 — One-shot backfill: rekey orphaned principal_bio overrides.
 *
 * For deals where SPEC-13.5 PR-A already migrated management profiles
 * (assigning new canonical UUIDs), but the override keys in
 * deal_memo_overrides still reference the old legacy UUIDs.
 *
 * Algorithm per deal:
 *   1. Load all deal_memo_overrides.overrides keys matching principal_bio_{uuid}
 *   2. Load all deal_management_profiles for the deal
 *   3. For each orphaned key (uuid not in canonical profiles):
 *      a. Extract person_name intent from the legacy key chain:
 *         - Look up the uuid in ownership_entities → display_name
 *         - Match by exact person_name to a canonical profile
 *      b. If exactly one match: rewrite key to principal_bio_{canonicalId}
 *      c. If zero or multiple matches: flag for manual review (do NOT auto-rekey)
 *   4. Write the rewritten overrides back to deal_memo_overrides
 *   5. Emit one audit event per deal with before/after key map
 *
 * Usage:
 *   pnpm tsx scripts/foundation-pr1-rekey-principal-bios.ts --dry-run
 *   pnpm tsx scripts/foundation-pr1-rekey-principal-bios.ts --execute
 *
 * Idempotent: re-running on already-rekeyed deals is a no-op (the uuid
 * in the key already matches a canonical profile → no rewrite needed).
 */

// Minimal bootstrap — this script runs standalone, not inside Next.js.
// We use the SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars directly.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRINCIPAL_BIO_PREFIX = "principal_bio_";

const mode = process.argv.includes("--execute") ? "execute" : "dry-run";

function getSupabase(): SupabaseClient {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set env vars.",
    );
    process.exit(1);
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type RekeyProposal = {
  dealId: string;
  overridesBefore: Record<string, unknown>;
  overridesAfter: Record<string, unknown>;
  rekeyed: Array<{ from: string; to: string; personName: string }>;
  orphaned: Array<{ key: string; reason: string }>;
  noOp: boolean;
};

async function proposeRekeysForDeal(
  sb: SupabaseClient,
  dealId: string,
): Promise<RekeyProposal | null> {
  // 1. Load overrides
  const { data: overrideRow } = await (sb as any)
    .from("deal_memo_overrides")
    .select("overrides, bank_id")
    .eq("deal_id", dealId)
    .maybeSingle();
  if (!overrideRow || !overrideRow.overrides) return null;

  const overrides: Record<string, unknown> = overrideRow.overrides;

  // 2. Load canonical profiles
  const { data: profiles } = await (sb as any)
    .from("deal_management_profiles")
    .select("id, person_name")
    .eq("deal_id", dealId);
  const canonicalById = new Map<string, string>(
    ((profiles ?? []) as Array<{ id: string; person_name: string }>).map(
      (p) => [p.id, p.person_name],
    ),
  );
  const canonicalByName = new Map<string, string[]>();
  for (const p of (profiles ?? []) as Array<{
    id: string;
    person_name: string;
  }>) {
    const name = (p.person_name ?? "").trim().toLowerCase();
    if (!name) continue;
    const ids = canonicalByName.get(name) ?? [];
    ids.push(p.id);
    canonicalByName.set(name, ids);
  }

  // 3. Load ownership_entities for person_name resolution
  const { data: owners } = await (sb as any)
    .from("ownership_entities")
    .select("id, display_name")
    .eq("deal_id", dealId);
  const ownerNameById = new Map<string, string>(
    ((owners ?? []) as Array<{ id: string; display_name: string | null }>).map(
      (o) => [o.id, (o.display_name ?? "").trim()],
    ),
  );

  // 4. Build rekey proposals
  const rekeyed: RekeyProposal["rekeyed"] = [];
  const orphaned: RekeyProposal["orphaned"] = [];
  const rewritten: Record<string, unknown> = {};
  let changed = false;

  for (const [key, value] of Object.entries(overrides)) {
    if (!key.startsWith(PRINCIPAL_BIO_PREFIX)) {
      rewritten[key] = value;
      continue;
    }

    const suffix = key.slice(PRINCIPAL_BIO_PREFIX.length);

    // Skip non-UUID keys (e.g., principal_bio_general)
    if (!UUID_RE.test(suffix)) {
      rewritten[key] = value;
      continue;
    }

    // Already canonical? (uuid exists in deal_management_profiles)
    if (canonicalById.has(suffix)) {
      rewritten[key] = value;
      continue; // no-op — already correct
    }

    // Orphaned UUID — try to resolve via person_name
    const ownerName = ownerNameById.get(suffix) ?? "";
    if (!ownerName) {
      orphaned.push({
        key,
        reason: `UUID ${suffix} not found in ownership_entities — cannot resolve person_name`,
      });
      rewritten[key] = value; // preserve as-is
      continue;
    }

    const matches = canonicalByName.get(ownerName.toLowerCase()) ?? [];
    if (matches.length === 1) {
      const canonicalId = matches[0];
      const newKey = `${PRINCIPAL_BIO_PREFIX}${canonicalId}`;
      rekeyed.push({
        from: key,
        to: newKey,
        personName: ownerName,
      });
      rewritten[newKey] = value;
      changed = true;
    } else if (matches.length === 0) {
      orphaned.push({
        key,
        reason: `person_name "${ownerName}" has no match in deal_management_profiles`,
      });
      rewritten[key] = value;
    } else {
      orphaned.push({
        key,
        reason: `person_name "${ownerName}" has ${matches.length} matches in deal_management_profiles — ambiguous`,
      });
      rewritten[key] = value;
    }
  }

  return {
    dealId,
    overridesBefore: overrides,
    overridesAfter: rewritten,
    rekeyed,
    orphaned,
    noOp: !changed,
  };
}

async function main() {
  console.log(`\n=== SPEC-FOUNDATION-V1 PR1: rekey principal_bio overrides ===`);
  console.log(`Mode: ${mode}\n`);

  const sb = getSupabase();

  // The 4 SPEC-13.5 backfilled deals
  const dealIds = [
    "0279ed32-c25c-4919-b231-5790050331dd", // Samaritus
    "80fe6f7a-5c68-4f02-8bcf-933f246a9fc5", // OmniCare May 1
    "0d31ebf3-485d-414e-a8ac-9b0e79884944", // OmniCare Review
    "e505cd1c-86b4-4d73-88e3-bc71ef342d94", // Test Pack #1
  ];

  let totalRekeyed = 0;
  let totalOrphaned = 0;
  let dealsModified = 0;

  for (const dealId of dealIds) {
    console.log(`--- Deal ${dealId} ---`);
    const proposal = await proposeRekeysForDeal(sb, dealId);

    if (!proposal) {
      console.log("  No deal_memo_overrides row found. Skipping.\n");
      continue;
    }

    if (proposal.noOp && proposal.orphaned.length === 0) {
      console.log("  No-op: all keys already canonical or no UUID-shaped principal_bio keys.\n");
      continue;
    }

    if (proposal.rekeyed.length > 0) {
      console.log(`  Rekeys proposed (${proposal.rekeyed.length}):`);
      for (const r of proposal.rekeyed) {
        console.log(`    ${r.from} → ${r.to}  (person: ${r.personName})`);
      }
    }

    if (proposal.orphaned.length > 0) {
      console.log(`  Orphaned (manual review needed, ${proposal.orphaned.length}):`);
      for (const o of proposal.orphaned) {
        console.log(`    ${o.key}: ${o.reason}`);
      }
    }

    if (!proposal.noOp && mode === "execute") {
      // Write rekeyed overrides
      const { error } = await (sb as any)
        .from("deal_memo_overrides")
        .update({ overrides: proposal.overridesAfter })
        .eq("deal_id", dealId);
      if (error) {
        console.error(`  ❌ UPDATE failed: ${error.message}`);
        continue;
      }
      console.log(`  ✓ Overrides updated.`);

      // Emit audit event
      await (sb as any).from("deal_events").insert({
        deal_id: dealId,
        kind: "memo_input.legacy_migration_backfill",
        payload: {
          actor_user_id: "system:foundation-pr1-backfill",
          input: {
            rekeyed: proposal.rekeyed,
            orphaned: proposal.orphaned,
            keys_before: Object.keys(proposal.overridesBefore).filter((k) =>
              k.startsWith(PRINCIPAL_BIO_PREFIX),
            ),
            keys_after: Object.keys(proposal.overridesAfter).filter((k) =>
              k.startsWith(PRINCIPAL_BIO_PREFIX),
            ),
          },
        },
      });
      console.log(`  ✓ Audit event written.`);
      dealsModified += 1;
    } else if (!proposal.noOp) {
      console.log(`  [dry-run] Would update overrides.`);
    }

    totalRekeyed += proposal.rekeyed.length;
    totalOrphaned += proposal.orphaned.length;
    console.log();
  }

  console.log(`=== Summary ===`);
  console.log(`  Total keys rekeyed: ${totalRekeyed}`);
  console.log(`  Total orphaned (manual review): ${totalOrphaned}`);
  console.log(`  Deals modified: ${mode === "execute" ? dealsModified : `${dealsModified} (dry-run, 0 actual writes)`}`);
  console.log(`  Mode: ${mode}\n`);

  if (mode === "dry-run" && totalRekeyed > 0) {
    console.log(
      "  To execute: pnpm tsx scripts/foundation-pr1-rekey-principal-bios.ts --execute\n",
    );
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

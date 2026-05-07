/**
 * SPEC-13.5 PR-A A-4 — One-time backfill of legacy `deal_memo_overrides`
 * into canonical `deal_borrower_story` + `deal_management_profiles`.
 *
 * Reads every row in `deal_memo_overrides` with non-empty `overrides` JSON,
 * runs the migration helper (now wired with `trustedBankId` from PR-A
 * Commit 2), and emits a per-deal audit event with the result counts.
 *
 * Idempotent: the migration wrapper short-circuits when a borrower-story
 * row already exists for the deal (handled via `borrowerStoryAlreadyExists`
 * inside `migrateLegacyOverridesToCanonical`). Re-runnable safely.
 *
 * KNOWN BENIGN ERROR DURING EXECUTION:
 *   "[clerkAuth] failed: TypeError: _react.default.createContext is not a function"
 * This fires once per upsert from refreshDealReadiness's fire-and-forget chain,
 * which indirectly imports a Next.js client-runtime piece that can't run in a
 * pure Node tsx script. The error is caught by the fire-and-forget and has zero
 * data integrity impact — the upsert itself completes successfully before the
 * readiness refresh fires. Do NOT add a clerkAuth shim or rewire the script
 * to suppress this; it's expected behavior outside a request context.
 *
 * Run:
 *   pnpm tsx --conditions=react-server scripts/spec-13-5-backfill.ts
 *
 * Why `--conditions=react-server`:
 *   The migration helper, the writers, and writeEvent each import
 *   "server-only" which throws in plain Node runtime. The react-server
 *   condition routes `server-only` to its empty stub. (Same trick the
 *   Next.js server bundle uses internally.)
 *
 * Required env vars:
 *   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE
 *
 * Per-deal qualified assertions (per amended A-4 items 3 and 4):
 *   - If overrides has business_description ≥ 20 chars → assert ≥ 1
 *     borrower_story row after migration.
 *   - If overrides has any principal_bio_* key with ≥ 20 chars → assert
 *     ≥ 1 management_profile row after migration.
 *   - Deals without these pre-conditions are documented zero-output cases,
 *     not failures.
 *
 * Exits non-zero if any qualified assertion fails or any migration call
 * throws.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { migrateLegacyOverridesToCanonical } from "@/lib/creditMemo/inputs/migrateLegacyOverridesAsync";
import { writeEvent } from "@/lib/ledger/writeEvent";

type LegacyRow = {
  deal_id: string;
  bank_id: string;
  overrides: Record<string, unknown> | null;
};

type DealLite = {
  id: string;
  display_name: string | null;
  bank_id: string;
};

type PerDealResult = {
  dealId: string;
  displayName: string | null;
  bankId: string;
  legacyKeysFound: string[];
  preCondHasBizDesc: boolean;
  preCondHasPrincipalBio: boolean;
  borrowerStoryWrites: number;
  managementProfileWrites: number;
  skippedReason: string | null;
  error: string | null;
  // Post-migration DB counts (verification, independent of wrapper return).
  bsRowsAfter: number;
  mpRowsAfter: number;
  // Assertions: null = pre-condition not met (not applicable).
  bsAssertionPassed: boolean | null;
  mpAssertionPassed: boolean | null;
};

const PRINCIPAL_BIO_PREFIX = "principal_bio_";

function asTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasQualifiedBizDesc(overrides: Record<string, unknown>): boolean {
  return asTrimmed(overrides.business_description).length >= 20;
}

function hasQualifiedPrincipalBio(
  overrides: Record<string, unknown>,
): boolean {
  for (const [k, v] of Object.entries(overrides)) {
    if (!k.startsWith(PRINCIPAL_BIO_PREFIX)) continue;
    if (asTrimmed(v).length >= 20) return true;
  }
  return false;
}

async function loadDealLite(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<DealLite | null> {
  const { data, error } = await (sb as any)
    .from("deals")
    .select("id, display_name, bank_id")
    .eq("id", dealId)
    .maybeSingle();
  if (error || !data) return null;
  return data as DealLite;
}

async function countRows(
  sb: ReturnType<typeof supabaseAdmin>,
  table: "deal_borrower_story" | "deal_management_profiles",
  dealId: string,
): Promise<number> {
  const { count } = await (sb as any)
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId);
  return count ?? 0;
}

function formatDealHeader(r: PerDealResult): string {
  const name = r.displayName ?? "(unnamed)";
  return `${name}  (${r.dealId})`;
}

async function main(): Promise<void> {
  const sb = supabaseAdmin();

  // 1. Pull every legacy row.
  const { data: legacyRows, error } = await (sb as any)
    .from("deal_memo_overrides")
    .select("deal_id, bank_id, overrides");

  if (error) {
    console.error("[backfill] failed to query deal_memo_overrides", error);
    process.exit(1);
  }
  const rows = ((legacyRows as LegacyRow[]) ?? []).filter(
    (r) => r.overrides && typeof r.overrides === "object",
  );

  if (rows.length === 0) {
    console.log("[backfill] no legacy rows with object overrides — nothing to do");
    process.exit(0);
  }

  console.log(`[backfill] ${rows.length} legacy row(s) to process`);
  console.log("");

  const results: PerDealResult[] = [];

  for (const row of rows) {
    const overrides = row.overrides as Record<string, unknown>;
    const legacyKeysFound = Object.keys(overrides).sort();

    // Resolve canonical bank_id from `deals` (defense-in-depth — we expect
    // it to match row.bank_id, but trust the deals table).
    const dealLite = await loadDealLite(sb, row.deal_id);
    const bankId = dealLite?.bank_id ?? row.bank_id;
    const displayName = dealLite?.display_name ?? null;

    const result: PerDealResult = {
      dealId: row.deal_id,
      displayName,
      bankId,
      legacyKeysFound,
      preCondHasBizDesc: hasQualifiedBizDesc(overrides),
      preCondHasPrincipalBio: hasQualifiedPrincipalBio(overrides),
      borrowerStoryWrites: 0,
      managementProfileWrites: 0,
      skippedReason: null,
      error: null,
      bsRowsAfter: 0,
      mpRowsAfter: 0,
      bsAssertionPassed: null,
      mpAssertionPassed: null,
    };

    // 2. Run migration. The wrapper passes trustedBankId to writers, so no
    // Clerk session is needed.
    try {
      const migrationResult = await migrateLegacyOverridesToCanonical({
        dealId: row.deal_id,
        bankId,
        overrides,
      });
      result.borrowerStoryWrites = migrationResult.borrowerStoryWritten ? 1 : 0;
      result.managementProfileWrites = migrationResult.managementWrites;
      result.skippedReason = migrationResult.borrowerStorySkippedReason ?? null;
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
    }

    // 3. Independent verification — count actual DB rows.
    result.bsRowsAfter = await countRows(sb, "deal_borrower_story", row.deal_id);
    result.mpRowsAfter = await countRows(
      sb,
      "deal_management_profiles",
      row.deal_id,
    );

    // 4. Qualified assertions (amended A-4 items 3 and 4).
    if (result.preCondHasBizDesc) {
      result.bsAssertionPassed = result.bsRowsAfter >= 1;
    }
    if (result.preCondHasPrincipalBio) {
      result.mpAssertionPassed = result.mpRowsAfter >= 1;
    }

    // 5. Per-deal audit event.
    await writeEvent({
      dealId: row.deal_id,
      kind: "memo_input.spec_13_5_backfill",
      meta: {
        bank_id: bankId,
        legacy_keys_count: legacyKeysFound.length,
        legacy_keys: legacyKeysFound,
        pre_cond_has_biz_desc: result.preCondHasBizDesc,
        pre_cond_has_principal_bio: result.preCondHasPrincipalBio,
        borrower_story_writes: result.borrowerStoryWrites,
        management_profile_writes: result.managementProfileWrites,
        skipped_reason: result.skippedReason,
        bs_rows_after: result.bsRowsAfter,
        mp_rows_after: result.mpRowsAfter,
        bs_assertion_passed: result.bsAssertionPassed,
        mp_assertion_passed: result.mpAssertionPassed,
        error: result.error,
      },
    });

    results.push(result);
  }

  // ── Per-deal output ────────────────────────────────────────────────────
  console.log("=== Per-deal results ===\n");
  for (const r of results) {
    console.log(formatDealHeader(r));
    console.log(
      `  bank_id:                    ${r.bankId}`,
    );
    console.log(
      `  legacy keys (${r.legacyKeysFound.length}):  ${r.legacyKeysFound.join(", ")}`,
    );
    console.log(`  pre-conditions:`);
    console.log(
      `    business_description ≥ 20 chars:    ${r.preCondHasBizDesc}`,
    );
    console.log(
      `    principal_bio_* ≥ 20 chars:         ${r.preCondHasPrincipalBio}`,
    );
    console.log(`  migration outcome:`);
    console.log(`    borrower_story_writes:              ${r.borrowerStoryWrites}`);
    console.log(`    management_profile_writes:          ${r.managementProfileWrites}`);
    console.log(`    skipped_reason:                     ${r.skippedReason ?? "(none)"}`);
    if (r.error) {
      console.log(`    error:                              ${r.error}`);
    }
    console.log(`  post-migration DB counts:`);
    console.log(`    deal_borrower_story rows:           ${r.bsRowsAfter}`);
    console.log(`    deal_management_profiles rows:      ${r.mpRowsAfter}`);
    console.log(`  qualified assertions:`);
    console.log(
      `    bs ≥ 1 (when biz_desc ≥ 20):        ${
        r.bsAssertionPassed === null
          ? "N/A — pre-cond not met"
          : r.bsAssertionPassed
          ? "PASS"
          : "FAIL"
      }`,
    );
    console.log(
      `    mp ≥ 1 (when principal_bio ≥ 20):   ${
        r.mpAssertionPassed === null
          ? "N/A — pre-cond not met"
          : r.mpAssertionPassed
          ? "PASS"
          : "FAIL"
      }`,
    );
    console.log("");
  }

  // ── Aggregate ──────────────────────────────────────────────────────────
  const totalDeals = results.length;
  const totalBs = results.reduce((s, r) => s + r.borrowerStoryWrites, 0);
  const totalMp = results.reduce((s, r) => s + r.managementProfileWrites, 0);
  const errored = results.filter((r) => r.error).length;
  const failedAssertions = results.filter(
    (r) =>
      r.bsAssertionPassed === false || r.mpAssertionPassed === false,
  );

  console.log("=== Aggregate ===");
  console.log(`Deals processed:            ${totalDeals}`);
  console.log(`borrower_story writes:      ${totalBs}`);
  console.log(`management_profile writes:  ${totalMp}`);
  console.log(`Migration errors:           ${errored}`);
  console.log(`Failed qualified assertions: ${failedAssertions.length}`);

  if (failedAssertions.length > 0) {
    console.log("");
    console.log("⚠ FAILED ASSERTIONS — investigate before declaring backfill complete:");
    for (const r of failedAssertions) {
      console.log(`  - ${formatDealHeader(r)}`);
      if (r.bsAssertionPassed === false) {
        console.log(`      bs ≥ 1 (with biz_desc ≥ 20) → got ${r.bsRowsAfter}`);
      }
      if (r.mpAssertionPassed === false) {
        console.log(`      mp ≥ 1 (with principal_bio ≥ 20) → got ${r.mpRowsAfter}`);
      }
    }
    process.exit(1);
  }

  if (errored > 0) {
    console.log("");
    console.log(`⚠ ${errored} deal(s) errored during migration — see per-deal output.`);
    process.exit(1);
  }

  console.log("");
  console.log("✓ Backfill complete. All qualified assertions passed.");
}

main().catch((err) => {
  console.error("[backfill] uncaught error", err);
  process.exit(1);
});

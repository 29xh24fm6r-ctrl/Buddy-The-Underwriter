/**
 * SPEC-13 — async wrapper around `transformLegacyOverrides`.
 *
 * Server-only. Loads ownership_entities + checks for an existing
 * borrower-story row, then runs the pure transform and dispatches
 * upserts to the canonical tables.
 *
 * This is deliberately separate from the pure transform so node:test
 * unit tests can exercise the mapping without a Supabase client.
 */
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertBorrowerStory } from "./upsertBorrowerStory";
import { upsertManagementProfile } from "./upsertManagementProfile";
import {
  transformLegacyOverrides,
  type LegacyOverrideMap,
  type OwnershipEntityLite,
} from "./migrateLegacyOverridesToCanonical";

export type MigrateLegacyOverridesArgs = {
  dealId: string;
  bankId: string;
  overrides: LegacyOverrideMap;
};

export type MigrateLegacyOverridesResult = {
  borrowerStoryWritten: boolean;
  managementWrites: number;
  /** Reason for skipping a borrower-story write, if applicable. */
  borrowerStorySkippedReason?: "borrower_story_exists" | "no_useful_keys";
  // SPEC-FOUNDATION-V1 PR1: override key rewriting telemetry
  overrideKeysRewritten: number;
  orphanedOverrideKeys: string[];
};

export async function migrateLegacyOverridesToCanonical(
  args: MigrateLegacyOverridesArgs,
): Promise<MigrateLegacyOverridesResult> {
  const sb = supabaseAdmin();

  // Per-field idempotency check: only fields that already have a non-empty
  // value are excluded from migration. A row can exist with just naics_code
  // set (by a separate classification tool) while business_description/etc.
  // are still empty — gating on row existence alone would leave that legacy
  // content permanently stuck.
  const { data: existing } = await (sb as any)
    .from("deal_borrower_story")
    .select("business_description, revenue_model, seasonality, key_risks, banker_notes")
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId)
    .maybeSingle();
  const existingBorrowerStoryFields = new Set<string>(
    existing
      ? (Object.entries(existing as Record<string, unknown>)
          .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
          .map(([k]) => k))
      : [],
  );

  const { data: ownersRaw } = await (sb as any)
    .from("ownership_entities")
    .select("id, display_name")
    .eq("deal_id", args.dealId);
  const ownershipEntities: OwnershipEntityLite[] = (
    (ownersRaw ?? []) as Array<{ id: string; display_name: string | null }>
  ).map((row) => ({ id: row.id, display_name: row.display_name }));

  const result = transformLegacyOverrides({
    dealId: args.dealId,
    bankId: args.bankId,
    overrides: args.overrides,
    ownershipEntities,
    existingBorrowerStoryFields,
  });

  let borrowerStoryWritten = false;
  let borrowerStorySkippedReason:
    | MigrateLegacyOverridesResult["borrowerStorySkippedReason"]
    | undefined;

  // SPEC-13.5 addendum #10: args.bankId is trusted from caller — do NOT
  // re-resolve via getCurrentBankId() or ensureDealBankAccess(). The caller
  // (buildMemoInputPackage) has already verified tenant access. Re-resolution
  // re-introduces the access-check failure mode this fix exists to eliminate.
  // Pass `trustedBankId: args.bankId` through to writers so they skip their
  // redundant access check.
  if (result.borrowerStory.kind === "write") {
    const out = await upsertBorrowerStory({
      dealId: args.dealId,
      trustedBankId: args.bankId,
      patch: result.borrowerStory.write.patch,
      source: result.borrowerStory.write.source,
      confidence: result.borrowerStory.write.confidence,
    });
    if (!out.ok) {
      // SPEC-13.5 A-3: throw on writer failure rather than silently
      // recording `false`. Telemetry in buildMemoInputPackage captures this
      // throw as `error` in the memo_input.legacy_migration audit event.
      throw new Error(
        `migrateLegacyOverrides: borrower_story upsert failed (${out.reason}${
          out.error ? `: ${out.error}` : ""
        })`,
      );
    }
    borrowerStoryWritten = true;
  } else {
    borrowerStorySkippedReason = result.borrowerStory.reason;
  }

  let managementWrites = 0;
  // SPEC-FOUNDATION-V1 PR1: capture the legacy-to-canonical id mapping
  // so we can rekey principal_bio_{legacyId} override keys afterward.
  const legacyToCanonicalId = new Map<string, string>();
  for (const mp of result.managementProfiles) {
    const out = await upsertManagementProfile({
      dealId: args.dealId,
      trustedBankId: args.bankId,
      patch: mp.patch,
      source: mp.source,
      confidence: mp.confidence,
    });
    if (!out.ok) {
      // SPEC-13.5 A-3: throw on writer failure (see borrower_story branch).
      throw new Error(
        `migrateLegacyOverrides: management_profile upsert failed (${out.reason}${
          out.error ? `: ${out.error}` : ""
        })`,
      );
    }
    legacyToCanonicalId.set(mp.ownershipEntityId, out.profile.id);
    managementWrites += 1;
  }

  // SPEC-FOUNDATION-V1 PR1: rewrite principal_bio_{legacyId} → principal_bio_{canonicalId}
  // in deal_memo_overrides so the readiness contract can find the bio under
  // the correct key. Only UUID-shaped suffixes are rekeyed; non-UUID keys
  // (e.g., principal_bio_general) are preserved as-is.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const PRINCIPAL_BIO_PREFIX = "principal_bio_";
  let overrideKeysRewritten = 0;
  const orphanedOverrideKeys: string[] = [];

  if (legacyToCanonicalId.size > 0) {
    const rewritten: Record<string, unknown> = {};
    let changed = false;
    for (const [key, value] of Object.entries(args.overrides)) {
      if (key.startsWith(PRINCIPAL_BIO_PREFIX)) {
        const suffix = key.slice(PRINCIPAL_BIO_PREFIX.length);
        if (UUID_RE.test(suffix)) {
          const canonicalId = legacyToCanonicalId.get(suffix);
          if (canonicalId && canonicalId !== suffix) {
            rewritten[`${PRINCIPAL_BIO_PREFIX}${canonicalId}`] = value;
            overrideKeysRewritten += 1;
            changed = true;
            continue;
          } else if (!canonicalId) {
            // UUID-shaped key that didn't match any profile we just created.
            // Preserve it but flag for human review.
            orphanedOverrideKeys.push(key);
          }
        }
      }
      rewritten[key] = value;
    }

    if (changed) {
      await (sb as any)
        .from("deal_memo_overrides")
        .update({ overrides: rewritten })
        .eq("deal_id", args.dealId)
        .eq("bank_id", args.bankId);
    }
  }

  return {
    borrowerStoryWritten,
    managementWrites,
    borrowerStorySkippedReason,
    overrideKeysRewritten,
    orphanedOverrideKeys,
  };
}

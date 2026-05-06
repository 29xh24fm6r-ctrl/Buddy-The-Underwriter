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
};

export async function migrateLegacyOverridesToCanonical(
  args: MigrateLegacyOverridesArgs,
): Promise<MigrateLegacyOverridesResult> {
  const sb = supabaseAdmin();

  // Idempotency check: if a borrower-story row already exists, the
  // transform short-circuits to "skipped". The pure helper is told via
  // borrowerStoryAlreadyExists.
  const { data: existing } = await (sb as any)
    .from("deal_borrower_story")
    .select("id")
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId)
    .maybeSingle();
  const borrowerStoryAlreadyExists = !!existing;

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
    borrowerStoryAlreadyExists,
  });

  let borrowerStoryWritten = false;
  let borrowerStorySkippedReason:
    | MigrateLegacyOverridesResult["borrowerStorySkippedReason"]
    | undefined;

  if (result.borrowerStory.kind === "write") {
    const out = await upsertBorrowerStory({
      dealId: args.dealId,
      patch: result.borrowerStory.write.patch,
      source: result.borrowerStory.write.source,
      confidence: result.borrowerStory.write.confidence,
    });
    borrowerStoryWritten = out.ok;
  } else {
    borrowerStorySkippedReason = result.borrowerStory.reason;
  }

  let managementWrites = 0;
  for (const mp of result.managementProfiles) {
    const out = await upsertManagementProfile({
      dealId: args.dealId,
      patch: mp.patch,
      source: mp.source,
      confidence: mp.confidence,
    });
    if (out.ok) managementWrites += 1;
  }

  return {
    borrowerStoryWritten,
    managementWrites,
    borrowerStorySkippedReason,
  };
}

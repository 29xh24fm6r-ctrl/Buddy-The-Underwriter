/**
 * SPEC-13 — backfill helper.
 *
 * One-time migration from legacy `deal_memo_overrides.overrides` JSON
 * into the canonical `deal_borrower_story` row + N
 * `deal_management_profiles` rows. Idempotent: skips writes when a
 * borrower-story row already exists for the deal.
 *
 * The transform is split into a PURE step (no DB) and a thin server-only
 * wrapper that:
 *   - loads ownership_entities (for principal_bio_<uuid> → person_name)
 *   - calls upsertBorrowerStory + upsertManagementProfile
 *
 * Tests run against the pure step. Do not import the wrapper from
 * test files.
 */

const PRINCIPAL_BIO_PREFIX = "principal_bio_";

export type LegacyOverrideMap = Record<string, unknown>;

export type OwnershipEntityLite = {
  id: string;
  display_name: string | null;
};

export type LegacyTransformInput = {
  dealId: string;
  bankId: string;
  overrides: LegacyOverrideMap;
  ownershipEntities: OwnershipEntityLite[];
  /**
   * Borrower-story fields (business_description, revenue_model, seasonality,
   * key_risks, banker_notes) that already have a non-empty value in the
   * existing deal_borrower_story row. Empty set means no row exists yet, or
   * the row exists but none of these fields are populated.
   *
   * This is per-field rather than a single "row exists" boolean: a row can
   * already exist with only unrelated fields populated (e.g. naics_code set
   * by a separate classification tool) while business_description/etc. are
   * still empty. Gating the whole migration on row existence would leave
   * that legacy content stuck forever — never migrated because a row
   * technically exists, but also never manually re-entered because the
   * banker doesn't know it's missing. Only fields already populated are
   * skipped; anything still empty is still eligible to migrate.
   */
  existingBorrowerStoryFields: ReadonlySet<string>;
};

export type BorrowerStoryWrite = {
  patch: {
    business_description?: string | null;
    revenue_model?: string | null;
    seasonality?: string | null;
    key_risks?: string | null;
    banker_notes?: string | null;
  };
  source: "banker";
  confidence: 0.85;
};

export type ManagementProfileWrite = {
  /** Owner UUID stripped from the `principal_bio_<uuid>` key. */
  ownershipEntityId: string;
  patch: {
    person_name: string;
    resume_summary: string;
  };
  source: "banker";
  confidence: 0.85;
};

export type LegacyTransformResult = {
  borrowerStory:
    | { kind: "skipped"; reason: "borrower_story_exists" | "no_useful_keys" }
    | { kind: "write"; write: BorrowerStoryWrite };
  managementProfiles: ManagementProfileWrite[];
};

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/**
 * Pure transform. No DB, no side effects.
 *
 * Mapping rules:
 *   business_description    → borrower_story.business_description
 *   revenue_mix             → borrower_story.revenue_model
 *   seasonality             → borrower_story.seasonality
 *   competitive_advantages  → borrower_story.key_risks (free-form note)
 *   banker_summary          → borrower_story.banker_notes
 *   principal_bio_<uuid>    → management_profiles[<entityId>].resume_summary,
 *                             person_name from ownership_entities.display_name
 *                             ("Unknown" when no match)
 *
 * Keys that don't fit (collateral_description, tabs_viewed, etc.) are
 * intentionally ignored — collateral is owned by deal_collateral_items
 * via document extraction; UI breadcrumbs are not banker-canonical input.
 */
export function transformLegacyOverrides(
  input: LegacyTransformInput,
): LegacyTransformResult {
  const { overrides, ownershipEntities, existingBorrowerStoryFields } = input;

  // Borrower-story patch — only fields not already populated are eligible.
  const businessDescription = existingBorrowerStoryFields.has("business_description")
    ? null
    : asTrimmedString(overrides.business_description);
  const revenueModel = existingBorrowerStoryFields.has("revenue_model")
    ? null
    : asTrimmedString(overrides.revenue_mix);
  const seasonality = existingBorrowerStoryFields.has("seasonality")
    ? null
    : asTrimmedString(overrides.seasonality);
  const competitiveAdvantages = existingBorrowerStoryFields.has("key_risks")
    ? null
    : asTrimmedString(overrides.competitive_advantages);
  const bankerSummary = existingBorrowerStoryFields.has("banker_notes")
    ? null
    : asTrimmedString(overrides.banker_summary);

  const patch: BorrowerStoryWrite["patch"] = {};
  if (businessDescription !== null) patch.business_description = businessDescription;
  if (revenueModel !== null) patch.revenue_model = revenueModel;
  if (seasonality !== null) patch.seasonality = seasonality;
  if (competitiveAdvantages !== null) patch.key_risks = competitiveAdvantages;
  if (bankerSummary !== null) patch.banker_notes = bankerSummary;

  const borrowerStory: LegacyTransformResult["borrowerStory"] =
    Object.keys(patch).length === 0
      ? {
          kind: "skipped",
          reason: existingBorrowerStoryFields.size > 0 ? "borrower_story_exists" : "no_useful_keys",
        }
      : { kind: "write", write: { patch, source: "banker", confidence: 0.85 } };

  // Management-profile writes.
  const entityById = new Map(
    ownershipEntities.map((e) => [e.id, e.display_name ?? null]),
  );
  const managementProfiles: ManagementProfileWrite[] = [];
  for (const [key, raw] of Object.entries(overrides)) {
    if (!key.startsWith(PRINCIPAL_BIO_PREFIX)) continue;
    const ownerId = key.slice(PRINCIPAL_BIO_PREFIX.length);
    const summary = asTrimmedString(raw);
    if (summary === null) continue;
    const displayName = entityById.get(ownerId)?.trim() ?? "";
    const personName = displayName.length > 0 ? displayName : "Unknown";
    managementProfiles.push({
      ownershipEntityId: ownerId,
      patch: { person_name: personName, resume_summary: summary },
      source: "banker",
      confidence: 0.85,
    });
  }

  return { borrowerStory, managementProfiles };
}

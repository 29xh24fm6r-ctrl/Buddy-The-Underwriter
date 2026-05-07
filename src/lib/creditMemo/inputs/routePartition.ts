// SPEC-13.5 PR-B B-3 (R1) — pure helper that splits a BankerReviewPanel
// patch into the two endpoints that should receive its fields.
//
// PURITY: no DOM, no fetch, no server-only. Importable from both client
// components ("use client") and server code, and tested without DB.
//
// Routing contract (Option A — see specs/follow-ups/SPEC-13.5-V12-deferred-findings.md):
//
//   Canonical fields → POST /api/deals/[dealId]/memo-inputs
//                       body: { kind: "from-wizard", overrides: <flat shape> }
//                       writes: deal_borrower_story + deal_management_profiles
//
//     business_description, revenue_mix, seasonality
//     principal_bio_<uuid> keys (collapsed into principal_bios sub-record)
//
//   UI-state fields → POST /api/deals/[dealId]/credit-memo/overrides
//                       (the deprecation shim — no DB write, telemetry only)
//
//     tabs_viewed, committee_ready, committee_reviewed_at,
//     covenant_banker_notes, covenant_adjustments,
//     qualitative_override_* (5 dimensions)
//
// Default for unrecognized keys: route to UI-state (the shim). Per Option
// A, the shim no-ops, so unknown keys are silently dropped with telemetry
// — preferred over silently writing them to a canonical store they don't
// belong in. If a future field needs canonical persistence, add it
// explicitly to CANONICAL_KEYS or PRINCIPAL_BIO_PREFIX semantics.

export type CanonicalPatchFields = {
  business_description?: string | null;
  revenue_mix?: string | null;
  seasonality?: string | null;
  /** Map of ownership_entity_id → resume summary text. Flattened back to
   *  `principal_bio_<uuid>` keys when POSTed to /memo-inputs. */
  principal_bios?: Record<string, string>;
};

export type UIStatePatchFields = {
  tabs_viewed?: string[];
  committee_ready?: boolean;
  committee_reviewed_at?: string;
  covenant_banker_notes?: string;
  covenant_adjustments?: unknown;
  qualitative_override_character?: unknown;
  qualitative_override_capital?: unknown;
  qualitative_override_conditions?: unknown;
  qualitative_override_management?: unknown;
  qualitative_override_business_model?: unknown;
};

export type RoutePartitionResult = {
  canonical: CanonicalPatchFields;
  uiState: UIStatePatchFields;
};

const PRINCIPAL_BIO_PREFIX = "principal_bio_";

const CANONICAL_KEYS = new Set<string>([
  "business_description",
  "revenue_mix",
  "seasonality",
]);

/**
 * Partition a BankerReviewPanel patch into canonical vs UI-state subsets.
 *
 * The result objects only contain keys that were present in the input —
 * an empty `canonical` or `uiState` means "skip that endpoint."
 */
export function routePartition(
  patch: Record<string, unknown>,
): RoutePartitionResult {
  const canonical: CanonicalPatchFields = {};
  const uiState: UIStatePatchFields = {};

  for (const [key, value] of Object.entries(patch)) {
    if (key.startsWith(PRINCIPAL_BIO_PREFIX)) {
      const ownerId = key.slice(PRINCIPAL_BIO_PREFIX.length);
      if (typeof value === "string") {
        canonical.principal_bios = canonical.principal_bios ?? {};
        canonical.principal_bios[ownerId] = value;
      }
      continue;
    }
    if (CANONICAL_KEYS.has(key)) {
      // Cast: the typed canonical fields are string|null|undefined.
      (canonical as Record<string, unknown>)[key] = value;
      continue;
    }
    // Default: UI-state. Includes the explicit UI-state keys above plus
    // any unknown key. Per Option A, unknown keys hit the deprecation
    // shim and are dropped (telemetry-pinged, not persisted).
    (uiState as Record<string, unknown>)[key] = value;
  }

  return { canonical, uiState };
}

/**
 * Helper: convert a CanonicalPatchFields back into the flat `overrides`
 * payload shape that postFromWizard expects (principal_bios collapsed
 * back to `principal_bio_<uuid>` keys).
 */
export function flattenCanonicalForFromWizard(
  canonical: CanonicalPatchFields,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (canonical.business_description !== undefined) {
    out.business_description = canonical.business_description;
  }
  if (canonical.revenue_mix !== undefined) {
    out.revenue_mix = canonical.revenue_mix;
  }
  if (canonical.seasonality !== undefined) {
    out.seasonality = canonical.seasonality;
  }
  if (canonical.principal_bios) {
    for (const [ownerId, bio] of Object.entries(canonical.principal_bios)) {
      out[`${PRINCIPAL_BIO_PREFIX}${ownerId}`] = bio;
    }
  }
  return out;
}

export function hasAnyCanonicalField(canonical: CanonicalPatchFields): boolean {
  return (
    canonical.business_description !== undefined ||
    canonical.revenue_mix !== undefined ||
    canonical.seasonality !== undefined ||
    (canonical.principal_bios !== undefined &&
      Object.keys(canonical.principal_bios).length > 0)
  );
}

export function hasAnyUIStateField(uiState: UIStatePatchFields): boolean {
  return Object.keys(uiState).length > 0;
}

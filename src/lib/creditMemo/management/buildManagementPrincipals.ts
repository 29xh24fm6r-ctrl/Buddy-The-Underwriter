/**
 * Phase 7 — Management Principal Builder
 *
 * Builds the management_qualifications.principals array from canonical sources.
 * Source priority:
 *   1. deal_management_profiles (per-person bios)
 *   2. ownership_entities (ownership/guarantor identity only)
 *   3. principal_bio_* overrides (legacy fallback)
 *   4. qualitative MANAGEMENT facts
 *   5. Pending
 *
 * Pure function — no DB, no server-only. Safe for CI guards.
 */

export type ManagementProfile = {
  person_name: string;
  title?: string | null;
  ownership_pct?: number | null;
  years_experience?: number | null;
  industry_experience?: string | null;
  prior_business_experience?: string | null;
  resume_summary?: string | null;
  credit_relevance?: string | null;
};

export type OwnershipEntity = {
  id: string;
  display_name?: string | null;
  ownership_pct?: number | null;
  title?: string | null;
  entity_type?: string | null;
};

export type PrincipalRow = {
  id: string;
  name: string;
  ownership_pct: number | null;
  title: string | null;
  bio: string;
  years_experience: number | null;
  prior_roles: string[];
  other_income_sources: string | null;
};

export type BuildPrincipalsArgs = {
  managementProfiles: ManagementProfile[];
  ownerEntities: OwnershipEntity[];
  overrides: Record<string, unknown>;
  qualMgmtBackground: string | null;
  qualMgmtExpYears: string | null;
  borrowerName: string | null;
  dealDisplayName: string | null;
};

// ─── Entity detection ──────────────────────────────────────────────────────

import { isLikelyEntityName as isLikelyEntity } from "@/lib/ownership/entityClassification";

// ─── Bio builder ───────────────────────────────────────────────────────────

import { joinSentences, cleanMemoNarrative } from "@/lib/creditMemo/text/cleanMemoNarrative";

function buildBioFromProfile(profile: ManagementProfile): string | null {
  const parts: string[] = [];
  if (profile.resume_summary) parts.push(profile.resume_summary);
  if (profile.industry_experience) parts.push(profile.industry_experience);
  if (profile.prior_business_experience) parts.push(`Prior: ${profile.prior_business_experience}`);
  if (profile.credit_relevance) parts.push(`Credit: ${profile.credit_relevance}`);
  return parts.length > 0 ? joinSentences(parts) : null;
}

// ─── Main builder ──────────────────────────────────────────────────────────

export function buildManagementPrincipals(args: BuildPrincipalsArgs): {
  principals: PrincipalRow[];
  aliasesDeduped: string[];
} {
  const {
    managementProfiles, ownerEntities, overrides,
    qualMgmtBackground, qualMgmtExpYears, borrowerName, dealDisplayName,
  } = args;

  const mgmtFallbackBio = qualMgmtBackground
    ? `${qualMgmtBackground}${qualMgmtExpYears ? ` (${qualMgmtExpYears} years experience)` : ""}`
    : null;

  // Track covered names and surnames for dedupe
  const coveredNames = new Set<string>();
  const coveredLastTokens = new Map<string, { fullName: string; ownershipPct: number | null }>();
  const aliasesDeduped: string[] = [];

  // Step 1: Principals from deal_management_profiles
  const principalsFromProfiles: PrincipalRow[] = managementProfiles.map((p) => {
    const name = String(p.person_name ?? "Unknown");
    const lower = name.toLowerCase().trim();
    coveredNames.add(lower);
    const tokens = lower.split(/\s+/);
    if (tokens.length > 0) {
      coveredLastTokens.set(tokens[tokens.length - 1], {
        fullName: lower,
        ownershipPct: p.ownership_pct ?? null,
      });
    }

    const matchedEntity = ownerEntities.find(
      (o) => (o.display_name ?? "").toLowerCase().trim() === lower,
    );
    const entityId = matchedEntity?.id ?? name;
    const bioKey = `principal_bio_${entityId}`;
    const profileBio = buildBioFromProfile(p);
    const overrideBio = typeof overrides[bioKey] === "string" ? (overrides[bioKey] as string) : null;

    return {
      id: String(entityId),
      name,
      ownership_pct: p.ownership_pct ?? matchedEntity?.ownership_pct ?? null,
      title: p.title ?? matchedEntity?.title ?? null,
      bio: cleanMemoNarrative(profileBio ?? overrideBio ?? mgmtFallbackBio ?? "Pending — complete borrower interview to populate management qualifications."),
      years_experience: p.years_experience ?? (qualMgmtExpYears ? Number(qualMgmtExpYears) : null),
      prior_roles: p.prior_business_experience ? [p.prior_business_experience] : [],
      other_income_sources: null,
    };
  });

  // Step 2: Add person-like ownership entities not already covered
  const principalsFromEntities: PrincipalRow[] = ownerEntities
    .filter((o) => {
      const name = (o.display_name ?? "") as string;
      const lower = name.toLowerCase().trim();
      if (coveredNames.has(lower)) return false;
      if (isLikelyEntity(name, borrowerName, dealDisplayName)) return false;
      // Surname match dedupe
      if (!lower.includes(" ") && coveredLastTokens.has(lower)) {
        aliasesDeduped.push(name);
        return false;
      }
      // Multi-word name where last token matches a profile surname
      const tokens = lower.split(/\s+/);
      const lastToken = tokens[tokens.length - 1];
      if (tokens.length > 0 && coveredLastTokens.has(lastToken)) {
        const match = coveredLastTokens.get(lastToken)!;
        // A shared surname alone is not proof of the same person — two real
        // co-owners (e.g. spouses, parent/child) can share a surname while
        // both have no ownership_pct on file yet. Only treat this as the
        // SAME person when there's a genuine matching ownership percentage
        // (both non-null and equal), or the covered profile is already the
        // 100% owner (nothing left for a distinct co-owner to hold).
        if (
          (match.ownershipPct !== null && match.ownershipPct === (o.ownership_pct ?? null)) ||
          match.ownershipPct === 100
        ) {
          aliasesDeduped.push(name);
          return false;
        }
      }
      return true;
    })
    .map((o) => {
      const bioKey = `principal_bio_${o.id}`;
      const overrideBio = typeof overrides[bioKey] === "string" ? (overrides[bioKey] as string) : null;
      return {
        id: String(o.id),
        name: o.display_name ?? "Unknown",
        ownership_pct: o.ownership_pct ?? null,
        title: o.title ?? null,
        bio: cleanMemoNarrative(overrideBio ?? mgmtFallbackBio ?? "Pending — complete borrower interview to populate management qualifications."),
        years_experience: qualMgmtExpYears ? Number(qualMgmtExpYears) : null,
        prior_roles: [],
        other_income_sources: null,
      };
    });

  return {
    principals: [...principalsFromProfiles, ...principalsFromEntities],
    aliasesDeduped,
  };
}

/**
 * SPEC-13 — pure builders extracted from prefillMemoInputs.ts.
 *
 * The parent module imports "server-only", which blocks node:test from
 * importing it. The pure helpers below take all inputs as plain values
 * (no Supabase client, no fetch) so they're testable directly and
 * re-exported by the server module.
 */
import type {
  MemoInputPrefill,
  SuggestedManagementProfile,
} from "./prefillTypes";

export type LegacyOverrideMap = Record<string, unknown>;

export type ResearchLite = {
  industry_overview?: string | null;
  market_dynamics?: string | null;
  competitive_positioning?: string | null;
  litigation_and_risk?: string | null;
} | null | undefined;

export type DealLite =
  | {
      description?: string | null;
      industry?: string | null;
      naics_code?: string | null;
    }
  | null;

export type OwnerLite = {
  id?: string;
  display_name?: string | null;
  ownership_pct?: number | null;
  title?: string | null;
};

export function buildBorrowerStorySuggestions(args: {
  deal: DealLite;
  research: ResearchLite;
  legacyOverrides: LegacyOverrideMap;
}): MemoInputPrefill["borrower_story"] {
  const out: MemoInputPrefill["borrower_story"] = {};
  const { deal, research, legacyOverrides } = args;

  if (research?.industry_overview && research.industry_overview !== "Pending") {
    out.business_description = {
      value: research.industry_overview,
      source: "research",
      confidence: 0.7,
      reason: "Research mission's industry overview narrative",
    };
  } else if (deal?.description && typeof deal.description === "string") {
    out.business_description = {
      value: String(deal.description).trim(),
      source: "deal",
      confidence: 0.6,
      reason: "Description captured at deal intake",
    };
  } else if (
    typeof legacyOverrides.business_description === "string" &&
    legacyOverrides.business_description.trim().length > 0
  ) {
    out.business_description = {
      value: legacyOverrides.business_description.trim(),
      source: "banker_override_legacy",
      confidence: 0.85,
      reason: "Banker-entered legacy memo override (deal_memo_overrides)",
    };
  } else if (deal?.industry || deal?.naics_code) {
    const industry = String(deal.industry ?? "").trim();
    out.business_description = {
      value: industry
        ? `Operates in ${industry}.`
        : `NAICS ${deal.naics_code}`,
      source: "deal",
      confidence: 0.4,
      reason: "Inferred from intake industry / NAICS",
    };
  }

  if (research?.market_dynamics && research.market_dynamics !== "Pending") {
    out.products_services = {
      value: research.market_dynamics,
      source: "research",
      confidence: 0.6,
      reason: "Research market dynamics narrative",
    };
  }

  if (
    research?.competitive_positioning &&
    research.competitive_positioning !== "Pending"
  ) {
    out.competitive_position = {
      value: research.competitive_positioning,
      source: "research",
      confidence: 0.7,
      reason: "Research competitive landscape",
    };
  }

  if (research?.litigation_and_risk) {
    out.key_risks = {
      value: research.litigation_and_risk,
      source: "research",
      confidence: 0.6,
      reason: "Research litigation & risk section",
    };
  } else if (
    typeof legacyOverrides.seasonality === "string" &&
    legacyOverrides.seasonality.trim().length > 0
  ) {
    out.key_risks = {
      value: legacyOverrides.seasonality.trim(),
      source: "banker_override_legacy",
      confidence: 0.85,
      reason: "Banker-entered seasonality from legacy memo override",
    };
  }

  if (
    typeof legacyOverrides.revenue_mix === "string" &&
    legacyOverrides.revenue_mix.trim().length > 0
  ) {
    out.revenue_model = {
      value: legacyOverrides.revenue_mix.trim(),
      source: "banker_override_legacy",
      confidence: 0.85,
      reason: "Banker-entered revenue mix from legacy memo override",
    };
  }

  return out;
}

export function buildManagementSuggestions(args: {
  owners: OwnerLite[];
  legacyOverrides: LegacyOverrideMap;
}): SuggestedManagementProfile[] {
  const profiles: SuggestedManagementProfile[] = [];
  for (const o of args.owners) {
    const name = String(o.display_name ?? "").trim();
    if (!name) continue;
    const profile: SuggestedManagementProfile = {
      person_name: {
        value: name,
        source: "deal",
        confidence: 0.95,
        source_id: typeof o.id === "string" ? o.id : undefined,
        reason: "Captured at intake (ownership_entities)",
      },
    };
    if (typeof o.ownership_pct === "number") {
      profile.ownership_pct = {
        value: String(o.ownership_pct),
        source: "deal",
        confidence: 0.95,
        reason: "Ownership percentage from intake",
      };
    }
    if (typeof o.title === "string" && o.title.trim().length > 0) {
      profile.title = {
        value: o.title,
        source: "deal",
        confidence: 0.85,
        reason: "Title from intake",
      };
    }
    const bioKey = typeof o.id === "string" ? `principal_bio_${o.id}` : null;
    const bioRaw = bioKey ? args.legacyOverrides[bioKey] : null;
    if (typeof bioRaw === "string" && bioRaw.trim().length > 0) {
      profile.resume_summary = {
        value: bioRaw.trim(),
        source: "banker_override_legacy",
        confidence: 0.85,
        source_id: typeof o.id === "string" ? o.id : undefined,
        reason: "Banker-entered principal bio from legacy memo override",
      };
    }
    profiles.push(profile);
  }
  return profiles;
}

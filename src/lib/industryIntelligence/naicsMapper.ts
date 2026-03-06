import type { IndustryProfile } from "./types";
import { MARITIME_PROFILE } from "./profiles/maritime";
import { REAL_ESTATE_PROFILE } from "./profiles/realEstate";
import { MEDICAL_PROFILE } from "./profiles/medical";
import { CONSTRUCTION_PROFILE } from "./profiles/construction";
import { RETAIL_PROFILE } from "./profiles/retail";
import { RESTAURANT_PROFILE } from "./profiles/restaurant";
import { PROFESSIONAL_SERVICES_PROFILE } from "./profiles/professionalServices";
import { DEFAULT_PROFILE } from "./profiles/default";

/**
 * Map a NAICS code to its industry profile.
 * Returns the default profile for null, empty, or unmapped codes.
 */
export function getIndustryProfile(
  naicsCode: string | null,
): IndustryProfile {
  if (!naicsCode) return DEFAULT_PROFILE;

  if (naicsCode.startsWith("4872")) return MARITIME_PROFILE;
  if (naicsCode.startsWith("531")) return REAL_ESTATE_PROFILE;
  if (
    naicsCode.startsWith("621") ||
    naicsCode.startsWith("622") ||
    naicsCode.startsWith("623")
  )
    return MEDICAL_PROFILE;
  if (
    naicsCode.startsWith("236") ||
    naicsCode.startsWith("237") ||
    naicsCode.startsWith("238")
  )
    return CONSTRUCTION_PROFILE;
  if (naicsCode.startsWith("44") || naicsCode.startsWith("45"))
    return RETAIL_PROFILE;
  if (naicsCode.startsWith("722")) return RESTAURANT_PROFILE;
  if (naicsCode.startsWith("541")) return PROFESSIONAL_SERVICES_PROFILE;

  return DEFAULT_PROFILE;
}

/**
 * Get a human-readable display name for a NAICS code.
 */
export function getIndustryDisplayName(
  naicsCode: string | null,
): string {
  if (!naicsCode) return "Unknown Industry";
  return getIndustryProfile(naicsCode).displayName;
}

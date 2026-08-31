/**
 * US state reference data for the brokerage CRM.
 *
 * Bank lending geography was previously free prose — production held
 * 'New York', 'TX' and 'RI' in the same column, and crm_lender_profiles
 * .geographies held values like 'Nationwide' alongside 'GA'. Nothing could
 * filter on it. Everything that writes a state now routes through
 * normalizeStateCode() so the stored value is always a two-letter USPS code
 * or null, which is what migration 20260831140000 backfilled the existing
 * rows to and what crm_organizations_state_code_check enforces.
 *
 * Pure data + pure functions: no database, no server-only imports, so both
 * the client pickers and the server handlers use the same source.
 */

export const US_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "PR", name: "Puerto Rico" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

const BY_CODE = new Map(US_STATES.map((s) => [s.code, s]));
const BY_NAME = new Map(US_STATES.map((s) => [s.name.toLowerCase(), s]));

/** Values that mean "everywhere" rather than a place. */
const NATIONWIDE_WORDS = new Set([
  "nationwide",
  "national",
  "us",
  "usa",
  "u.s.",
  "u.s.a.",
  "all",
  "all states",
  "everywhere",
]);

export function isNationwideWord(value: unknown): boolean {
  return typeof value === "string" && NATIONWIDE_WORDS.has(value.trim().toLowerCase());
}

/**
 * "tx" | "Texas" | " TX " → "TX". Anything that is not a US state (including
 * the nationwide words, which are a geography *mode*, not a state) → null.
 */
export function normalizeStateCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (BY_CODE.has(upper)) return upper;
  const byName = BY_NAME.get(trimmed.toLowerCase());
  return byName ? byName.code : null;
}

export function stateName(code: unknown): string | null {
  const normalized = normalizeStateCode(code);
  return normalized ? (BY_CODE.get(normalized)?.name ?? null) : null;
}

/**
 * Parses a mixed list — an array, or a comma/newline separated string, as
 * typed into the legacy geographies box — into a deduped, sorted list of
 * state codes plus whether the list said "nationwide" anywhere.
 */
export function parseStateList(value: unknown): { codes: string[]; nationwide: boolean } {
  const raw: string[] = Array.isArray(value)
    ? value.map((v) => String(v))
    : typeof value === "string"
      ? value.split(/[,\n]/)
      : [];

  let nationwide = false;
  const codes = new Set<string>();
  for (const entry of raw) {
    if (isNationwideWord(entry)) {
      nationwide = true;
      continue;
    }
    const code = normalizeStateCode(entry);
    if (code) codes.add(code);
  }
  return { codes: Array.from(codes).sort(), nationwide };
}

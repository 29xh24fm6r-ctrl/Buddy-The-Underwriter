export type MemoPersonRole =
  | "borrower_principal"
  | "guarantor"
  | "banker"
  | "bank_officer"
  | "borrower_contact"
  | "unknown";

export type MemoPersonReference = {
  canonicalName: string;
  role: MemoPersonRole;
  aliases?: string[];
  preferLastName?: boolean;
};

export type NarrativeTrustWarning = {
  code:
    | "ambiguous_first_name_rewritten"
    | "nickname_rewritten"
    | "unresolved_single_name_reference"
    | "double_punctuation_removed";
  original: string;
  replacement?: string;
  detail: string;
};

export type NarrativeTrustResult = {
  text: string | null;
  warnings: NarrativeTrustWarning[];
};

const BANK_NICKNAME_ALIASES: Array<{ pattern: RegExp; replacement: string; detail: string }> = [
  {
    pattern: /\bMike\s+Ringer\b/g,
    replacement: "Mike Ring",
    detail: "Known Old Glory Bank nickname/transcript confusion: Mike Ringer should render as Mike Ring.",
  },
  {
    pattern: /\bRinger\b/g,
    replacement: "Ring",
    detail: "Known Old Glory Bank nickname/transcript confusion: Ringer should render as Ring.",
  },
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameParts(name: string): { first: string; last: string } | null {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { first: parts[0], last: parts[parts.length - 1] };
}

function uniquePeople(people: MemoPersonReference[]): MemoPersonReference[] {
  const seen = new Set<string>();
  const out: MemoPersonReference[] = [];
  for (const p of people) {
    const key = p.canonicalName.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export function buildMemoPeopleFromRows(args: {
  ownerEntities?: Array<{ display_name?: string | null; name?: string | null; ownership_pct?: number | null }>;
  managementProfiles?: Array<{ person_name?: string | null; ownership_pct?: number | null }>;
}): MemoPersonReference[] {
  const people: MemoPersonReference[] = [];

  for (const owner of args.ownerEntities ?? []) {
    const canonicalName = String(owner.display_name ?? owner.name ?? "").trim();
    if (!canonicalName) continue;
    people.push({
      canonicalName,
      role: Number(owner.ownership_pct ?? 0) > 0 ? "borrower_principal" : "unknown",
      preferLastName: true,
    });
  }

  for (const profile of args.managementProfiles ?? []) {
    const canonicalName = String(profile.person_name ?? "").trim();
    if (!canonicalName) continue;
    people.push({
      canonicalName,
      role: Number(profile.ownership_pct ?? 0) > 0 ? "borrower_principal" : "borrower_contact",
      preferLastName: true,
    });
  }

  return uniquePeople(people);
}

export function sanitizeMemoNarrativeText(
  value: string | null | undefined,
  people: MemoPersonReference[],
): NarrativeTrustResult {
  if (typeof value !== "string") return { text: value ?? null, warnings: [] };

  let text = value;
  const warnings: NarrativeTrustWarning[] = [];

  for (const alias of BANK_NICKNAME_ALIASES) {
    if (alias.pattern.test(text)) {
      text = text.replace(alias.pattern, alias.replacement);
      warnings.push({
        code: "nickname_rewritten",
        original: alias.pattern.source,
        replacement: alias.replacement,
        detail: alias.detail,
      });
    }
    alias.pattern.lastIndex = 0;
  }

  const firstNameCounts = new Map<string, number>();
  const normalizedPeople = uniquePeople(people);
  for (const p of normalizedPeople) {
    const parts = nameParts(p.canonicalName);
    if (!parts) continue;
    const key = parts.first.toLowerCase();
    firstNameCounts.set(key, (firstNameCounts.get(key) ?? 0) + 1);
  }

  for (const p of normalizedPeople) {
    const parts = nameParts(p.canonicalName);
    if (!parts || !p.preferLastName) continue;

    const firstName = parts.first;
    const lastName = parts.last;
    const firstNamePattern = new RegExp(`\\b${escapeRegex(firstName)}\\b(?!\\s+${escapeRegex(lastName)}\\b)`, "g");

    if (firstNamePattern.test(text)) {
      const ambiguous = (firstNameCounts.get(firstName.toLowerCase()) ?? 0) > 1;
      text = text.replace(firstNamePattern, lastName);
      warnings.push({
        code: ambiguous ? "ambiguous_first_name_rewritten" : "unresolved_single_name_reference",
        original: firstName,
        replacement: lastName,
        detail: ambiguous
          ? `First-name-only reference '${firstName}' is ambiguous across memo participants; rendered as '${lastName}'.`
          : `First-name-only reference '${firstName}' was rendered by last name for committee memo clarity.`,
      });
    }
    firstNamePattern.lastIndex = 0;
  }

  const beforePunctuation = text;
  text = text
    .replace(/\.\. +/g, ". ")
    .replace(/\.\.(?=\S)/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
  if (text !== beforePunctuation.trim()) {
    warnings.push({
      code: "double_punctuation_removed",
      original: "..",
      detail: "Cleaned transcript/memo narrative punctuation artifacts.",
    });
  }

  return { text: text || null, warnings };
}

export function sanitizeBorrowerStoryPatch<T extends Record<string, unknown>>(
  patch: T,
  people: MemoPersonReference[],
): { patch: T; warnings: NarrativeTrustWarning[] } {
  const out: Record<string, unknown> = { ...patch };
  const warnings: NarrativeTrustWarning[] = [];

  for (const [key, value] of Object.entries(patch)) {
    if (typeof value !== "string") continue;
    const result = sanitizeMemoNarrativeText(value, people);
    out[key] = result.text;
    warnings.push(...result.warnings.map((w) => ({ ...w, detail: `${key}: ${w.detail}` })));
  }

  return { patch: out as T, warnings };
}

/**
 * Owner identity matching — "is this the same human?"
 *
 * WHY THIS EXISTS.
 *
 * `ownership_entities` has no unique constraint on (deal_id, display_name),
 * so every writer hand-rolls its own upsert and every writer has to answer
 * the same question: does this name already have a row?
 *
 * The previous answer was `name.toLowerCase().replace(/\s+/g, "")`. That
 * catches re-renders with different spacing or casing — "Sebrina Colon" vs
 * "sebrinacolon" — and nothing else. Deal b296dec2 ended up with THREE
 * owners totalling 149%:
 *
 *   Sebrina Colon   51%
 *   Matthew Paller  49%
 *   matt paller     49%   ← same person, two days later
 *
 * "matthewpaller" and "mattpaller" are different strings, so the normalized
 * key matched nothing and a third row was inserted.
 *
 * THE MATCHING RULE.
 *
 * Two names are the SAME PERSON when their family names are equal after
 * normalization AND their given names are equivalent, where equivalent
 * means any of:
 *
 *   - identical                       ("matthew" / "matthew")
 *   - a known nickname pair           ("bill" / "william")
 *   - one is a prefix of the other,   ("matt" / "matthew", "deb" / "debra")
 *     with the shorter at least 3 characters
 *
 * The 3-character prefix floor is the whole safety margin. Without it a
 * bare initial merges people: "M. Paller" would absorb both Matthew and
 * Michael. With it, "matt"/"matthew" merges (prefix, 4 chars) while
 * "michael"/"matthew" does not (neither is a prefix of the other) and
 * "m"/"matthew" does not (1 char). Siblings sharing a surname stay
 * separate unless one genuinely typed a shortening of the other's name.
 *
 * Middle names and suffixes are ignored for matching: "Matthew J. Paller"
 * and "Matthew Paller" are one person. A single-token name ("Cher") can
 * only match another single-token name.
 *
 * CONFIDENCE LEVELS.
 *
 *   "exact" — normalized strings are identical. Safe to merge silently.
 *   "near"  — same person by the rule above but spelled differently. Safe
 *             to merge server-side (never insert a second row), and worth
 *             confirming with the borrower in the UI: "Did you mean
 *             Matthew Paller?" is a better experience than silently
 *             renaming what they typed.
 *
 * Deliberately dependency-free and free of "server-only" so the borrower's
 * browser, the propagation writer and the sealing gate all share one
 * definition of owner identity.
 */

export type OwnerNameMatchKind = "exact" | "near";

export type OwnerNameParts = {
  /** Full name, normalized: lowercase, unaccented, single-spaced. */
  normalized: string;
  /** Normalized name with all separators removed — the legacy exact key. */
  compact: string;
  given: string;
  family: string;
  /** Everything between given and family, normalized. */
  middle: string[];
};

/**
 * Common English given-name shortenings that are NOT prefixes of their
 * formal form, so the prefix rule alone would miss them. Deliberately
 * short and conservative: every pair here is an unambiguous everyday
 * equivalence, not a guess. Prefix-style nicknames ("matt"/"matthew",
 * "chris"/"christopher") need no entry — the prefix rule covers them.
 */
const NICKNAME_GROUPS: string[][] = [
  ["william", "bill", "billy", "will", "liam"],
  ["robert", "bob", "bobby", "rob"],
  ["richard", "dick", "rick", "ricky"],
  ["john", "jack", "johnny", "jon"],
  ["james", "jim", "jimmy"],
  ["margaret", "peggy", "maggie", "meg"],
  ["elizabeth", "liz", "beth", "betty", "eliza"],
  ["katherine", "catherine", "kathryn", "kate", "katie", "kathy", "cathy"],
  ["charles", "chuck", "charlie"],
  ["henry", "hank", "harry"],
  ["edward", "ted", "ned", "eddie"],
  ["theodore", "ted", "teddy"],
  ["anthony", "tony"],
  ["joseph", "joe", "joey"],
  ["michael", "mike", "mick", "mickey"],
  ["thomas", "tom", "tommy"],
  ["daniel", "dan", "danny"],
  ["david", "dave", "davey"],
  ["patricia", "pat", "patty", "trish", "tricia"],
  ["barbara", "barb", "babs"],
  ["jennifer", "jen", "jenny"],
  ["susan", "sue", "suzy"],
  ["deborah", "debra", "deb", "debbie"],
  ["rebecca", "becky", "becca"],
  ["sandra", "sandy"],
  ["frances", "fran", "francis"],
  ["lawrence", "larry"],
  ["gregory", "greg"],
  ["nicholas", "nick", "nicky"],
  ["andrew", "andy", "drew"],
  ["steven", "stephen", "steve"],
  ["ronald", "ron", "ronnie"],
  ["kenneth", "ken", "kenny"],
  ["donald", "don", "donnie"],
  ["albert", "al", "bert"],
  ["alexander", "alex", "sasha"],
  ["samuel", "sam", "sammy"],
  ["benjamin", "ben", "benny"],
  ["eugene", "gene"],
  ["raymond", "ray"],
  ["vincent", "vince", "vinny"],
  ["walter", "walt"],
  ["arthur", "art", "artie"],
  ["jose", "pepe"],
  ["francisco", "paco", "pancho"],
  ["ignacio", "nacho"],
  ["guadalupe", "lupe"],
];

/** given-name → the id of the group it belongs to. */
const NICKNAME_GROUP_BY_NAME: Map<string, Set<number>> = (() => {
  const map = new Map<string, Set<number>>();
  NICKNAME_GROUPS.forEach((group, index) => {
    for (const name of group) {
      const existing = map.get(name) ?? new Set<number>();
      existing.add(index);
      map.set(name, existing);
    }
  });
  return map;
})();

/**
 * Generational and professional suffixes that carry no identity. Dropped
 * before picking the family name so "Matthew Paller Jr" keeps "paller" as
 * its family name rather than "jr".
 *
 * NOTE this means "Matthew Paller" and "Matthew Paller Jr" match. That is
 * the right default here: a borrower typing their own name inconsistently
 * is overwhelmingly more likely than a father and son on one cap table
 * where only one of them ever gets a suffix. The UI confirms near matches
 * before merging, which is where a genuine junior gets separated.
 */
const SUFFIXES = new Set([
  "jr", "sr", "ii", "iii", "iv", "v",
  "md", "phd", "esq", "cpa", "dds", "jd", "mba",
]);

/** Titles that precede a name and carry no identity. */
const PREFIXES = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "rev"]);

/**
 * Lowercase, strip accents, drop everything that is not a letter, digit or
 * separator, and collapse whitespace. Hyphens and apostrophes become
 * nothing rather than spaces so "O'Brien" → "obrien" and "Smith-Jones" →
 * "smithjones" stay single tokens.
 */
export function normalizeOwnerName(name: string | null | undefined): string {
  return String(name ?? "")
    .normalize("NFKD")
    // Combining marks left behind by NFKD — "é" → "e".
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’'`\-]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The legacy exact key: normalized with all spacing removed. Kept because
 * it is what makes "Matthew  Paller" (double space) and "matthewpaller"
 * land on the same row, and it is cheap to index by.
 */
export function ownerNameKey(name: string | null | undefined): string {
  return normalizeOwnerName(name).replace(/\s/g, "");
}

export function parseOwnerName(name: string | null | undefined): OwnerNameParts {
  const normalized = normalizeOwnerName(name);
  const tokens = normalized
    .split(" ")
    .filter(Boolean)
    .filter((t, i, arr) => {
      if (i === 0 && PREFIXES.has(t)) return false;
      // A suffix only counts as one when something precedes it, so a
      // person legitimately named "Iv" is not erased.
      if (i > 0 && i === arr.length - 1 && SUFFIXES.has(t)) return false;
      return true;
    });

  if (tokens.length === 0) {
    return { normalized, compact: "", given: "", family: "", middle: [] };
  }
  if (tokens.length === 1) {
    return {
      normalized,
      compact: normalized.replace(/\s/g, ""),
      given: tokens[0],
      family: "",
      middle: [],
    };
  }

  return {
    normalized,
    compact: normalized.replace(/\s/g, ""),
    given: tokens[0],
    family: tokens[tokens.length - 1],
    middle: tokens.slice(1, -1),
  };
}

/** Shortest given name we will treat as a prefix of a longer one. */
const MIN_PREFIX_LENGTH = 3;

function givenNamesEquivalent(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;

  const groupsA = NICKNAME_GROUP_BY_NAME.get(a);
  const groupsB = NICKNAME_GROUP_BY_NAME.get(b);
  if (groupsA && groupsB) {
    for (const group of groupsA) if (groupsB.has(group)) return true;
  }

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  // A bare initial is NOT enough: "m paller" must not absorb both Matthew
  // and Michael Paller.
  if (shorter.length < MIN_PREFIX_LENGTH) return false;
  return longer.startsWith(shorter);
}

/**
 * Do these two names denote the same person? Returns null when they do
 * not, so callers can distinguish "no match" from "matched exactly".
 */
export function compareOwnerNames(
  a: string | null | undefined,
  b: string | null | undefined,
): OwnerNameMatchKind | null {
  const left = parseOwnerName(a);
  const right = parseOwnerName(b);
  if (!left.compact || !right.compact) return null;
  if (left.compact === right.compact) return "exact";

  // Single-token names have no family name to anchor on. Only compare them
  // with other single-token names, and only by given-name equivalence.
  if (!left.family || !right.family) {
    if (left.family || right.family) return null;
    return givenNamesEquivalent(left.given, right.given) ? "near" : null;
  }

  if (left.family !== right.family) return null;
  return givenNamesEquivalent(left.given, right.given) ? "near" : null;
}

export type OwnerNameCandidate = { display_name?: string | null };

export type OwnerNameMatch<T extends OwnerNameCandidate> = {
  row: T;
  kind: OwnerNameMatchKind;
};

/**
 * Find the row in `existing` that denotes the same person as `name`.
 *
 * An exact match always wins over a near match, and among near matches the
 * first in the list wins — so repeated runs converge on one canonical row
 * instead of ping-ponging between duplicates that already exist.
 */
export function findOwnerNameMatch<T extends OwnerNameCandidate>(
  name: string | null | undefined,
  existing: readonly T[],
): OwnerNameMatch<T> | null {
  let near: OwnerNameMatch<T> | null = null;
  for (const row of existing) {
    const kind = compareOwnerNames(name, row.display_name);
    if (kind === "exact") return { row, kind };
    if (kind === "near" && !near) near = { row, kind };
  }
  return near;
}

/**
 * Group a list of owner names into same-person clusters. Used by the
 * sealing gate to report "these two rows are the same person" and by the
 * intake UI to stop the borrower adding a duplicate in the first place.
 *
 * Clustering is transitive by design — if A matches B and B matches C, all
 * three are one cluster — because that is how the duplicates actually
 * accumulate: each new spelling matches whichever earlier one it resembles.
 */
export function clusterOwnerNames<T extends OwnerNameCandidate>(
  rows: readonly T[],
): T[][] {
  const clusters: T[][] = [];
  for (const row of rows) {
    const target = clusters.find((cluster) =>
      cluster.some((member) => compareOwnerNames(row.display_name, member.display_name) !== null),
    );
    if (target) target.push(row);
    else clusters.push([row]);
  }
  return clusters;
}

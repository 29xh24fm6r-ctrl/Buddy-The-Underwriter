/**
 * Exhibit Registry — consistent exhibit labels across the memo.
 *
 * Assigns exhibit letters once based on which sections exist,
 * then provides labels for both the exhibit list and section headings.
 *
 * Pure function — no DB, no server-only.
 */

export type ExhibitEntry = {
  letter: string;
  label: string;
  present: boolean;
};

export type ExhibitRegistry = {
  entries: ExhibitEntry[];
  /** Get the full exhibit label for a section, e.g. "Exhibit A — Debt Coverage Analysis" */
  label(sectionKey: string): string | null;
};

type ExhibitConfig = {
  hasDebtCoverage: boolean;
  hasIncomeStatement: boolean;
  hasBalanceSheet: boolean;
  gcfStatus: "formal_complete" | "proxy_with_pfs" | "pending_pfs" | undefined;
  hasPfs: boolean;
  hasRatioAnalysis: boolean;
  hasStressAnalysis: boolean;
  hasCovenantPackage: boolean;
  hasQualitativeAssessment: boolean;
  hasBreakeven: boolean;
};

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export function buildExhibitRegistry(config: ExhibitConfig): ExhibitRegistry {
  const entries: ExhibitEntry[] = [];
  const keyToLetter = new Map<string, string>();
  let idx = 0;

  function add(key: string, label: string, present: boolean) {
    if (present) {
      const letter = LETTERS[idx++] ?? `${idx}`;
      entries.push({ letter, label, present: true });
      keyToLetter.set(key, letter);
    }
  }

  add("debt_coverage", "Debt Coverage Analysis (DSCR)", config.hasDebtCoverage);
  add("income_statement", "Income Statement Summary", config.hasIncomeStatement);
  add("balance_sheet", "Balance Sheet", config.hasBalanceSheet);

  // GCF label adapts to status
  const gcfLabel = config.gcfStatus === "formal_complete" ? "Global Cash Flow"
    : config.gcfStatus === "pending_pfs" ? "Global Cash Flow & Guarantor Support — Pending PFS"
    : "Global Cash Flow & Guarantor Support";
  add("gcf", gcfLabel, true); // Always present (even if proxy)

  add("pfs", "Personal Financial Statements", config.hasPfs);
  add("ratio_analysis", "Institutional Ratio Analysis", config.hasRatioAnalysis);
  add("stress_analysis", "Stress Analysis", config.hasStressAnalysis);
  add("covenant_package", "Proposed Covenant Package", config.hasCovenantPackage);
  add("qualitative_assessment", "Qualitative Assessment", config.hasQualitativeAssessment);
  add("breakeven", "Breakeven Analysis", config.hasBreakeven);

  return {
    entries,
    label(sectionKey: string): string | null {
      const letter = keyToLetter.get(sectionKey);
      if (!letter) return null;
      const entry = entries.find((e) => e.letter === letter);
      return entry ? `Exhibit ${letter} — ${entry.label}` : null;
    },
  };
}

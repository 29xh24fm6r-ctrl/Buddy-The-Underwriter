/**
 * SPEC-FINENGINE-KNOWLEDGE-WIRE-2 — accounting-basis derivation (pure).
 *
 * Captures whether a borrower reports on a CASH or ACCRUAL basis from the
 * source document, so the finengine can mark accrual-dependent metrics
 * (AR/AP/turnover/working-capital) "not meaningful" on a cash-basis borrower
 * instead of rating them against accrual bands.
 *
 * Pure — no DB, no server-only. The server-only writer (captureAccountingBasis)
 * composes these. Conservative: absence of evidence resolves to UNKNOWN, never a
 * guessed CASH (a wrong CASH would wrongly suppress real receivables metrics).
 */

export type AccountingBasis = "CASH" | "ACCRUAL" | "OTHER" | "UNKNOWN";

export const ACCOUNTING_BASIS_VALUES: readonly AccountingBasis[] = [
  "CASH",
  "ACCRUAL",
  "OTHER",
  "UNKNOWN",
] as const;

/**
 * Normalize a raw accounting-method string (from a tax-return method line or a
 * GAAP-statement basis note) to the four-value domain. Order matters: "modified
 * cash" and "income tax basis" must resolve to OTHER, not CASH, so the OTHER
 * markers are tested before the bare "cash" check.
 */
export function normalizeAccountingBasis(raw: string | null | undefined): AccountingBasis {
  if (!raw) return "UNKNOWN";
  const s = String(raw).toLowerCase();
  if (/\baccrual\b/.test(s)) return "ACCRUAL";
  if (/\b(hybrid|modified|other|income[\s-]*tax[\s-]*basis|tax[\s-]*basis)\b/.test(s)) return "OTHER";
  if (/\bcash\b/.test(s)) return "CASH";
  return "UNKNOWN";
}

/** Balance-sheet keys whose presence (non-zero) implies accrual recognition. */
export const ACCRUAL_BALANCE_KEYS: readonly string[] = [
  "ACCOUNTS_RECEIVABLE",
  "ACCOUNTS_PAYABLE",
  "INVENTORY",
  "SL_AR_GROSS",
  "SL_INVENTORY",
  "SL_ACCOUNTS_PAYABLE",
] as const;

/**
 * Derive the accounting basis from a document's OCR text.
 *
 * Sources (per §0.4):
 *   - 1065 Schedule B line 1 / 1120-S Schedule B line 1 / Schedule C line F —
 *     "Accounting method: ☒ Cash / ☐ Accrual / ☐ Other".
 *   - GAAP statements — a basis note ("prepared on the accrual basis",
 *     "cash basis of accounting", "modified cash basis").
 *
 * Returns UNKNOWN when no unambiguous evidence is found (never guesses CASH).
 */
export function deriveAccountingBasisFromText(
  ocrText: string | null | undefined,
  _opts?: { formType?: string },
): { basis: AccountingBasis; evidence: string | null } {
  if (!ocrText) return { basis: "UNKNOWN", evidence: null };
  const text = String(ocrText);

  // 1. The tax-return "Accounting method" line (Schedule B line 1 / Schedule C line F).
  const labelMatch = text.match(/accounting method\s*[:.]?\s*([^\n]{0,80})/i);
  if (labelMatch) {
    const win = labelMatch[1];
    // A checkbox mark (X / ✓ / ☒) immediately adjacent to one option wins.
    const marked = win.match(
      /[x✓☒]\s*\)?\s*(cash|accrual|hybrid|other)|(cash|accrual|hybrid|other)\s*[x✓☒]/i,
    );
    if (marked) {
      const opt = marked[1] ?? marked[2];
      return { basis: normalizeAccountingBasis(opt), evidence: `method line: ${win.trim()}` };
    }
    // No mark detected but exactly one option word present ⇒ that option.
    const lower = win.toLowerCase();
    const opts = ["accrual", "hybrid", "other", "cash"].filter((w) => lower.includes(w));
    if (opts.length === 1) {
      return { basis: normalizeAccountingBasis(opts[0]), evidence: `method line: ${win.trim()}` };
    }
  }

  // 2. Explicit basis-of-accounting phrase (GAAP statements / cover notes).
  const phrase = text.match(/\b(modified\s+cash|income[\s-]*tax\s+basis|accrual|cash)\s+(?:basis|method)\b/i);
  if (phrase) {
    return { basis: normalizeAccountingBasis(phrase[1]), evidence: `basis note: ${phrase[0].trim()}` };
  }

  return { basis: "UNKNOWN", evidence: null };
}

/**
 * Infer the basis from balance-sheet facts (the Form 1120 fallback — no standard
 * method line). Receivables / payables / inventory are accrual-recognition
 * artifacts, so their presence upgrades to ACCRUAL. Their absence is NOT evidence
 * of cash basis ⇒ UNKNOWN, never CASH (R2).
 */
export function inferAccountingBasisFromFacts(
  facts: Array<{ fact_key: string; fact_value_num: number | null }>,
): AccountingBasis {
  const hasAccrualArtifact = facts.some(
    (f) =>
      ACCRUAL_BALANCE_KEYS.includes(f.fact_key) &&
      f.fact_value_num != null &&
      Math.abs(f.fact_value_num) > 0,
  );
  return hasAccrualArtifact ? "ACCRUAL" : "UNKNOWN";
}

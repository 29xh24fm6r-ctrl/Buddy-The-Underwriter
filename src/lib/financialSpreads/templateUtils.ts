import type { FinancialFact, RenderedSpreadCell, RenderedSpreadCellV2, RenderedSpreadInputRef } from "@/lib/financialSpreads/types";

function isIsoDatePrefix(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(s);
}

export function factAsOfDate(fact: FinancialFact): string | null {
  const prov = fact.provenance as any;
  const fromProv = prov?.as_of_date;
  if (typeof fromProv === "string" && isIsoDatePrefix(fromProv)) return fromProv.slice(0, 10);
  if (typeof fact.fact_period_end === "string" && isIsoDatePrefix(fact.fact_period_end)) return fact.fact_period_end.slice(0, 10);
  return null;
}

export function pickLatestFact(args: {
  facts: FinancialFact[];
  factType: string;
  factKey: string;
}): FinancialFact | null {
  const candidates = args.facts.filter((f) => String(f.fact_type) === args.factType && String(f.fact_key) === args.factKey);
  if (candidates.length === 0) return null;

  // Prefer the most recent fact_period_end, otherwise created_at.
  candidates.sort((a, b) => {
    const aEnd = a.fact_period_end ?? "";
    const bEnd = b.fact_period_end ?? "";
    if (aEnd && bEnd && aEnd !== bEnd) return aEnd > bEnd ? -1 : 1;

    const aCreated = a.created_at ?? "";
    const bCreated = b.created_at ?? "";
    if (aCreated && bCreated && aCreated !== bCreated) return aCreated > bCreated ? -1 : 1;

    return 0;
  });

  return candidates[0] ?? null;
}

export function cellValueToNumber(cell: RenderedSpreadCell | undefined): number | null {
  if (cell === undefined) return null;
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  if (cell && typeof cell === "object" && "value" in cell) {
    const v = (cell as any).value;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return null;
}

export function cellDisplayValue(cell: RenderedSpreadCell | undefined): string {
  if (cell === undefined || cell === null) return "";
  if (typeof cell === "string") return cell;
  if (typeof cell === "number") return Number.isFinite(cell) ? String(cell) : "";
  if (cell && typeof cell === "object" && "value" in cell) {
    const v = (cell as any).value;
    if (v === null || v === undefined) return "";
    return String(v);
  }
  return "";
}

export function factToInputRef(fact: FinancialFact): RenderedSpreadInputRef {
  return {
    fact_type: String(fact.fact_type),
    fact_key: String(fact.fact_key),
    fact_period_end: fact.fact_period_end ?? null,
    source_document_id: fact.source_document_id ?? null,
  };
}

export function factToCell(fact: FinancialFact | null): RenderedSpreadCellV2 {
  if (!fact) {
    return { value: null, as_of_date: null, inputs_used: [] };
  }

  const value = typeof fact.fact_value_num === "number" ? fact.fact_value_num : fact.fact_value_num ? Number(fact.fact_value_num) : null;

  return {
    value: value !== null && Number.isFinite(value) ? value : null,
    as_of_date: factAsOfDate(fact),
    inputs_used: [factToInputRef(fact)],
  };
}

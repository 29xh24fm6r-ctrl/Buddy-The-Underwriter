export type BorrowerTaskStatus = "missing" | "received" | "review" | "partial";

export type BorrowerTask = {
  id: string;
  title: string;
  description: string | null;
  required: boolean;
  status: BorrowerTaskStatus;
  group: string;
  checklistKey: string;
  progress?: { satisfied: number; required: number } | null;
};

export function normalizeTaskTitle(input: string) {
  return String(input || "").replace(/\s+/g, " ").trim();
}

export function groupTaskTitle(title: string) {
  const t = title.toLowerCase();
  if (t.includes("tax")) return "Tax Returns";
  if (t.includes("bank statement") || t.includes("bank statements")) return "Bank Statements";
  if (t.includes("rent roll") || t.includes("lease") || t.includes("property")) return "Property";
  if (t.includes("balance sheet") || t.includes("income statement") || t.includes("financial")) return "Financials";
  if (t.includes("debt") || t.includes("schedule")) return "Debt";
  return "Other";
}

export function deriveBorrowerTaskStatus(item: {
  status?: string | null;
  required_years?: number[] | null;
  satisfied_years?: number[] | null;
}) {
  const status = String(item.status ?? "").toLowerCase();
  if (status === "received" || status === "satisfied") return "received" as const;
  if (status === "needs_review") return "review" as const;
  const requiredYears = Array.isArray(item.required_years) ? item.required_years : [];
  const satisfiedYears = Array.isArray(item.satisfied_years) ? item.satisfied_years : [];
  if (requiredYears.length > 0 && satisfiedYears.length > 0) return "partial" as const;
  return "missing" as const;
}

export function buildBorrowerTasksFromChecklist(items: Array<any>) {
  return (items || []).map((item: any) => {
    const title = normalizeTaskTitle(item.title || item.checklist_key || "Document");
    const status = deriveBorrowerTaskStatus(item);
    const requiredYears = Array.isArray(item.required_years) ? item.required_years : [];
    const satisfiedYears = Array.isArray(item.satisfied_years) ? item.satisfied_years : [];

    return {
      id: String(item.id ?? item.checklist_key),
      title,
      description: item.description ?? null,
      required: !!item.required,
      status,
      group: groupTaskTitle(title),
      checklistKey: String(item.checklist_key ?? ""),
      progress: requiredYears.length
        ? { satisfied: satisfiedYears.length, required: requiredYears.length }
        : null,
    } as BorrowerTask;
  });
}

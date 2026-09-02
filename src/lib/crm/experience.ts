/** Presentation only: never an authorization or data-access gate. */
export function isCrmExperienceEnabled(value: string | undefined): boolean {
  return value === "true";
}

export const CRM_ROOT = "/admin/brokerage/crm";
export type CrmSection = "today" | "pipeline" | "relationships" | "lenders" | "tools";

export function crmSection(pathname: string, view: string | null): CrmSection {
  if (pathname === CRM_ROOT) return view === "relationships" ? "relationships" : "today";
  if (pathname.startsWith(`${CRM_ROOT}/leads`)) return "pipeline";
  if (pathname.startsWith(`${CRM_ROOT}/buyers`)) return "lenders";
  if (pathname.startsWith(`${CRM_ROOT}/templates`) || pathname.startsWith(`${CRM_ROOT}/dedup`)) return "tools";
  return "relationships";
}

export type FocusTask = {
  id: string;
  title: string | null;
  due_at: string | null;
  organizationId: string | null;
  organizationName: string | null;
};

export function taskDueLabel(dueAt: string | null, now: number): string {
  const due = dueAt ? Date.parse(dueAt) : NaN;
  if (!Number.isFinite(due)) return "No due date";
  return due < now ? "Overdue" : `Due ${new Date(due).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} (UTC)`;
}

export function prioritizeTasks<T extends FocusTask>(tasks: T[]): T[] {
  const time = (value: string | null) => {
    const parsed = value ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? parsed : Infinity;
  };
  return [...tasks].sort((a, b) => time(a.due_at) - time(b.due_at));
}

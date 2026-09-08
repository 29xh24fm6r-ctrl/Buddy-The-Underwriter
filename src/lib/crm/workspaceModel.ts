import type { FocusTask } from "./experience";
import { TERMINAL_STAGES } from "@/lib/leads/stages";
export type LeadSnapshot = {
  id: string;
  business_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  status: string;
  loan_amount_requested?: number | null;
  next_action?: string | null;
  next_action_due_at?: string | null;
};
export const CLOSED_LEADS: ReadonlySet<string> = TERMINAL_STAGES;
export const humanLabel = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const leadTitle = (l: LeadSnapshot) =>
  l.business_name ||
  [l.first_name, l.last_name].filter(Boolean).join(" ") ||
  l.email ||
  "Unnamed lead";
export type WorkItem = {
  key: string;
  title: string;
  context: string;
  kind: "task" | "lead" | "relationship";
  due: string | null;
  recordId: string | null;
  recordName: string;
  recordKind: "organization" | "lead";
  why: string;
};
export function buildWorkQueue(
  tasks: FocusTask[],
  leads: LeadSnapshot[],
  relationships: { id: string; name: string; health: string }[],
): WorkItem[] {
  const items: WorkItem[] = [
    ...tasks.map((t) => ({
      key: `task:${t.id}`,
      title: t.title || "Untitled follow-up",
      context: t.organizationName || "Unlinked task",
      kind: "task" as const,
      due: t.due_at,
      recordId: t.organizationId,
      recordName: t.organizationName || "Relationship",
      recordKind: "organization" as const,
      why: "An open commitment recorded by your team.",
    })),
    ...leads
      .filter((l) => !CLOSED_LEADS.has(l.status))
      .map((l) => ({
        key: `lead:${l.id}`,
        title: l.next_action || `Choose the next step for ${leadTitle(l)}`,
        context: `${leadTitle(l)} · ${humanLabel(l.status)}`,
        kind: "lead" as const,
        due: l.next_action_due_at || null,
        recordId: l.id,
        recordName: leadTitle(l),
        recordKind: "lead" as const,
        why: l.next_action
          ? "The next action recorded on this lead."
          : "This active lead has no next action recorded.",
      })),
    ...relationships.map((o) => ({
      key: `relationship:${o.id}`,
      title: `Reconnect with ${o.name}`,
      context: humanLabel(o.health),
      kind: "relationship" as const,
      due: null,
      recordId: o.id,
      recordName: o.name,
      recordKind: "organization" as const,
      why: "Flagged by the existing relationship health signal.",
    })),
  ];
  const time = (s: string | null) =>
    s && Number.isFinite(Date.parse(s)) ? Date.parse(s) : Infinity;
  return items.sort(
    (a, b) => time(a.due) - time(b.due) || a.key.localeCompare(b.key),
  );
}

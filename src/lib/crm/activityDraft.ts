export type ActivityDraft = { kind: "note" | "call" | "meeting" | "task"; title: string; body: string; due: string };

export function activityPayload(organizationId: string, draft: ActivityDraft) {
  if (!organizationId.trim()) throw new Error("Choose a relationship first.");
  if (!draft.title.trim()) throw new Error("Add a short description.");
  const due = draft.kind === "task" ? new Date(draft.due) : null;
  if (due && !Number.isFinite(due.getTime())) throw new Error("Choose a valid follow-up date and time.");
  return {
    organizationId, kind: draft.kind, title: draft.title.trim(),
    properties: { body: draft.body.trim() },
    ...(due ? { dueAt: due.toISOString() } : {}),
    ...(["call", "meeting"].includes(draft.kind) ? { channel: draft.kind } : {}),
  };
}

/** Keep established lender capabilities even for multi-role organizations. */
export function hasLenderWorkspace(type: string, profile: unknown, submissionCount: number) {
  return type === "lender" || Boolean(profile) || submissionCount > 0;
}

export async function saveActivityDraft(organizationId: string, draft: ActivityDraft, request: typeof fetch = fetch) {
  const payload = activityPayload(organizationId, draft);
  const response = await request("/api/admin/brokerage/crm/activities", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok || !result.ok || typeof result.activity?.id !== "string" || !result.activity.id) {
    throw new Error("Activity save was not confirmed");
  }
  return result.activity.id as string;
}

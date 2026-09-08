import type { SB } from "./types";

export type TaskChange = {
  id: string;
  action: "complete" | "reopen" | "reschedule";
  dueAt?: string;
};
export function parseTaskChange(value: unknown): TaskChange {
  const body = value as Partial<TaskChange> | null;
  if (
    !body ||
    typeof body.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      body.id,
    )
  )
    throw new Error("A valid task is required.");
  if (!["complete", "reopen", "reschedule"].includes(body.action || ""))
    throw new Error("Choose a supported task action.");
  if (
    body.action === "reschedule" &&
    (typeof body.dueAt !== "string" ||
      !body.dueAt ||
      !Number.isFinite(Date.parse(body.dueAt)))
  )
    throw new Error("Choose a valid due date.");
  return {
    id: body.id,
    action: body.action!,
    ...(body.action === "reschedule"
      ? { dueAt: new Date(body.dueAt!).toISOString() }
      : {}),
  };
}

/** All mutations are constrained by both tenant and task kind. Never accepts a target or bank from the browser. */
export async function changeCrmTask(
  sb: SB,
  bankId: string,
  change: TaskChange,
  now = new Date().toISOString(),
) {
  const patch =
    change.action === "reschedule"
      ? { due_at: change.dueAt }
      : { completed_at: change.action === "complete" ? now : null };
  const { data, error } = await sb
    .from("crm_activities")
    .update(patch)
    .eq("bank_id", bankId)
    .eq("id", change.id)
    .eq("kind", "task")
    .select("id, title, due_at, completed_at")
    .maybeSingle();
  if (error)
    throw new Error(
      "Task update could not be confirmed. Refresh before retrying.",
    );
  return data;
}

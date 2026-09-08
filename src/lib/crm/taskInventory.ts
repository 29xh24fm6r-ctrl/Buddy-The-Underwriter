import type { SB } from "./types";

export const TASK_PAGE_SIZE = 100;
export async function listCrmTasks(
  sb: SB,
  bankId: string,
  page: number,
  completed = false,
) {
  let query = sb
    .from("crm_activities")
    .select(
      "id,title,due_at,completed_at,target_organization_id,target_person_id,target_lead_id,target_deal_id",
      { count: "exact" },
    )
    .eq("bank_id", bankId)
    .eq("kind", "task");
  query = completed
    ? query.not("completed_at", "is", null)
    : query.is("completed_at", null);
  const { data, count, error } = await query
    .order(completed ? "completed_at" : "due_at", {
      ascending: !completed,
      nullsFirst: false,
    })
    .order("id")
    .range(page * TASK_PAGE_SIZE, (page + 1) * TASK_PAGE_SIZE - 1);
  if (error) throw new Error("Tasks could not be loaded.");
  return {
    tasks: data || [],
    total: count ?? null,
    page,
    pageSize: TASK_PAGE_SIZE,
  };
}

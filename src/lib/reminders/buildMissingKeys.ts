// src/lib/reminders/buildMissingKeys.ts
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function getMissingChecklistKeys(dealId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from("deal_checklist_items")
    .select("checklist_key,status,required")
    .eq("deal_id", dealId)
    .eq("required", true);

  if (error || !data) return [];

  return data
    .filter((r) => r.status === "missing")
    .map((r) => r.checklist_key)
    .filter(Boolean);
}

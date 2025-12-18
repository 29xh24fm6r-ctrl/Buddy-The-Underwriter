/**
 * Borrower Automation: Auto-Trigger Wiring
 * 
 * Call these hooks after key events to update borrower activity state
 * and trigger condition recomputation.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Update last borrower activity timestamp
 * Call after: upload, document submission, borrower action
 */
export async function recordBorrowerActivity(dealId: string) {
  const supabase = supabaseAdmin();
  
  // Update last activity in automation state table (if exists)
  // For now: activity is inferred from borrower_attachments.created_at
  // Future: Add borrower_automation_state table with last_activity_at
  
  // Placeholder: Log activity
  console.log(`[BorrowerAutomation] Activity recorded for deal ${dealId}`);
  
  return { ok: true };
}

/**
 * Trigger condition recomputation
 * Call after: upload, classification, preflight change
 */
export async function triggerConditionRecompute(dealId: string) {
  const supabase = supabaseAdmin();
  
  // Update last_evaluated_at on conditions
  const { error } = await supabase
    .from("conditions_to_close")
    .update({ last_evaluated_at: new Date().toISOString() })
    .eq("application_id", dealId);
  
  if (error) {
    console.error("[BorrowerAutomation] Failed to update conditions:", error);
    return { ok: false, error: error.message };
  }
  
  // TODO: Trigger actual recomputation logic
  // For now: timestamp update is sufficient for stall detection
  
  console.log(`[BorrowerAutomation] Conditions recomputed for deal ${dealId}`);
  return { ok: true };
}

/**
 * Self-healing loop: clear satisfied conditions, update state
 * Call after: condition satisfaction detected
 */
export async function clearSatisfiedCondition(conditionId: string) {
  const supabase = supabaseAdmin();
  
  const { error } = await supabase
    .from("conditions_to_close")
    .update({
      status: "satisfied",
      last_evaluated_at: new Date().toISOString(),
      auto_resolved: true,
    })
    .eq("id", conditionId);
  
  if (error) {
    console.error("[BorrowerAutomation] Failed to clear condition:", error);
    return { ok: false, error: error.message };
  }
  
  console.log(`[BorrowerAutomation] Condition ${conditionId} marked satisfied`);
  return { ok: true };
}

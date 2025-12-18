// Auto-Recompute Hooks for Conditions
// Trigger conditions recompute when relevant data changes

import { supabaseAdmin } from "@/lib/supabase/admin";

export async function triggerConditionsRecompute(applicationId: string) {
  try {
    // Call the recompute API internally
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/deals/${applicationId}/conditions/recompute`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }
    );

    if (!response.ok) {
      console.error("Conditions recompute failed:", await response.text());
      return false;
    }

    const result = await response.json();
    console.log(
      `✅ Conditions recomputed for ${applicationId}: ${result.updated} updated`
    );
    return true;
  } catch (err) {
    console.error("Conditions recompute error:", err);
    return false;
  }
}

// Hook into document upload
export async function onDocumentUploaded(applicationId: string, attachmentId: string) {
  console.log(`📄 Document uploaded: ${attachmentId} - triggering conditions recompute`);
  await triggerConditionsRecompute(applicationId);
}

// Hook into document classification
export async function onDocumentClassified(applicationId: string, attachmentId: string) {
  console.log(
    `🏷️ Document classified: ${attachmentId} - triggering conditions recompute`
  );
  await triggerConditionsRecompute(applicationId);
}

// Hook into requirements recompute
export async function onRequirementsUpdated(applicationId: string) {
  console.log(`📋 Requirements updated - triggering conditions recompute`);
  await triggerConditionsRecompute(applicationId);
}

// Hook into preflight recompute
export async function onPreflightUpdated(applicationId: string) {
  console.log(`🔍 Preflight updated - triggering conditions recompute`);
  await triggerConditionsRecompute(applicationId);
}

// Hook into eligibility change
export async function onEligibilityUpdated(applicationId: string) {
  console.log(`✅ Eligibility updated - triggering conditions recompute`);
  await triggerConditionsRecompute(applicationId);
}

// Batch recompute for all applications (for migrations or rule changes)
export async function batchRecomputeConditions(tenantId?: string) {
  const sb = supabaseAdmin();

  const query = (sb as any).from("applications").select("id");
  if (tenantId) {
    query.eq("tenant_id", tenantId);
  }

  const { data: applications } = await query;

  if (!applications || applications.length === 0) {
    console.log("No applications to recompute");
    return;
  }

  console.log(`🔄 Batch recomputing conditions for ${applications.length} applications`);

  let success = 0;
  let failed = 0;

  for (const app of applications) {
    const result = await triggerConditionsRecompute(app.id);
    if (result) {
      success++;
    } else {
      failed++;
    }
  }

  console.log(`✅ Batch complete: ${success} succeeded, ${failed} failed`);
  return { success, failed, total: applications.length };
}

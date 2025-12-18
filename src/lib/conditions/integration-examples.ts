// Example: Integration of Conditions Auto-Triggers
// Add these hooks to your existing upload/classification handlers

import { onDocumentUploaded, onDocumentClassified } from "@/lib/conditions/hooks";

// ============================================
// EXAMPLE 1: After Document Upload
// ============================================

// In your existing upload route: src/app/api/deals/[dealId]/upload/route.ts
export async function POST(req: Request, { params }: { params: { dealId: string } }) {
  // ... existing upload logic ...
  
  const uploadResult = await uploadFile(file);
  
  // ✨ NEW: Trigger conditions recompute after upload
  await onDocumentUploaded(params.dealId, uploadResult.id);
  
  return Response.json({ ok: true });
}

// ============================================
// EXAMPLE 2: After Classification
// ============================================

// In your classification route: src/app/api/deals/[dealId]/classify/route.ts
export async function POST(req: Request, { params }: { params: { dealId: string } }) {
  const { attachmentId } = await req.json();
  
  // ... existing classification logic ...
  
  const classification = await classifyDocument(attachmentId);
  
  // Update attachment meta
  await updateAttachmentMeta(attachmentId, { classification });
  
  // ✨ NEW: Trigger conditions recompute after classification
  await onDocumentClassified(params.dealId, attachmentId);
  
  return Response.json({ ok: true, classification });
}

// ============================================
// EXAMPLE 3: After Requirements Recompute
// ============================================

// In: src/app/api/borrower/[token]/requirements/recompute/route.ts
import { onRequirementsUpdated } from "@/lib/conditions/hooks";

export async function POST(req: Request) {
  // ... existing requirements logic ...
  
  const result = await recomputeRequirements(applicationId);
  
  // ✨ NEW: Trigger conditions recompute
  await onRequirementsUpdated(applicationId);
  
  return Response.json({ ok: true, result });
}

// ============================================
// EXAMPLE 4: After Preflight Recompute
// ============================================

// In: src/app/api/deals/[dealId]/preflight/recompute/route.ts
import { onPreflightUpdated } from "@/lib/conditions/hooks";

export async function POST(req: Request, { params }: { params: { dealId: string } }) {
  // ... existing preflight logic ...
  
  const result = await runPreflight(params.dealId);
  
  // ✨ NEW: Trigger conditions recompute
  await onPreflightUpdated(params.dealId);
  
  return Response.json({ ok: true, result });
}

// ============================================
// EXAMPLE 5: Batch Recompute (Admin Tool)
// ============================================

// Create: src/app/api/admin/conditions/batch-recompute/route.ts
import { batchRecomputeConditions } from "@/lib/conditions/hooks";

export async function POST(req: Request) {
  const { tenantId } = await req.json();
  
  // Recompute all conditions for a tenant (or all tenants)
  const result = await batchRecomputeConditions(tenantId);
  
  return Response.json({
    ok: true,
    message: `Recomputed ${result.success} applications`,
    ...result,
  });
}

// ============================================
// EXAMPLE 6: Manual Trigger from UI
// ============================================

// In underwriter console, add a "Refresh Conditions" button
async function handleRefreshConditions() {
  const response = await fetch(`/api/deals/${dealId}/conditions/recompute`, {
    method: "POST",
  });
  
  const result = await response.json();
  
  if (result.ok) {
    alert(`✅ Conditions updated! ${result.updated} conditions evaluated.`);
    // Reload conditions data
    loadConditions();
  }
}

// ============================================
// EXAMPLE 7: Scheduled Background Job
// ============================================

// For periodic reconciliation (e.g., nightly)
import { batchRecomputeConditions } from "@/lib/conditions/hooks";

export async function reconcileAllConditions() {
  console.log("🔄 Starting nightly conditions reconciliation...");
  
  const result = await batchRecomputeConditions();
  
  console.log(`✅ Reconciliation complete: ${result.success}/${result.total} succeeded`);
  
  // Log to monitoring/observability system
  await logToDatadog({
    event: "conditions_reconciliation",
    success: result.success,
    failed: result.failed,
    total: result.total,
  });
}

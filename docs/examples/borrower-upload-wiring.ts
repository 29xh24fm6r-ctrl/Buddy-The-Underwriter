/**
 * Example: Wire borrower auto-registration into upload endpoint
 * 
 * Copy this pattern into your actual upload handlers to enable
 * self-healing borrower participation + API-level access control.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { registerBorrowerParticipant, touchParticipant } from "@/lib/deals/participants";
import { recordBorrowerActivity } from "@/lib/borrowerAutomation/triggers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Example POST endpoint for borrower file upload
 * 
 * After successful upload:
 * 1. Auto-register borrower as participant (self-healing)
 * 2. Touch participant to update activity timestamp
 * 3. Record activity for stall detection
 * 4. Optionally trigger condition recomputation
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await ctx.params;
  const { userId } = await auth();
  
  if (!userId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // ============================================
  // YOUR EXISTING UPLOAD LOGIC HERE
  // ============================================
  // const formData = await req.formData();
  // const file = formData.get("file");
  // ... upload to storage ...
  // ... create attachment record ...

  try {
    // ============================================
    // BORROWER AUTOMATION WIRING (ADD THIS)
    // ============================================
    
    // 1. Auto-register borrower on deal (safe to call multiple times)
    await registerBorrowerParticipant(dealId, userId);
    
    // 2. Touch participant to update activity timestamp
    await touchParticipant(dealId, userId, "borrower");
    
    // 3. Record activity for stall detection
    await recordBorrowerActivity(dealId);
    
    // 4. (Optional) Trigger condition recomputation if needed
    // import { triggerConditionRecompute } from "@/lib/borrowerAutomation/triggers";
    // await triggerConditionRecompute(dealId);

    return NextResponse.json({
      ok: true,
      deal_id: dealId,
      // ... your upload response ...
    });
  } catch (err: any) {
    console.error("[upload] Auto-registration failed:", err);
    // Upload succeeded but auto-registration failed - non-fatal
    // You may want to log this for monitoring
    return NextResponse.json({
      ok: true,
      deal_id: dealId,
      warning: "Participant registration failed",
    });
  }
}

/**
 * Where to wire this:
 * 
 * 1. Borrower file upload endpoints:
 *    - /api/deals/[dealId]/upload
 *    - /api/borrower/[token]/attachment/upload
 *    - Any endpoint where borrower uploads documents
 * 
 * 2. Borrower form submission:
 *    - /api/borrower/[token]/submit
 *    - /api/borrower/[token]/answer/upsert
 * 
 * 3. Document classification (if borrower-initiated):
 *    - After classification completes
 *    - Trigger condition recomputation
 * 
 * Benefits:
 * - Borrower uploads once → automatically linked to deal
 * - /borrower portal always finds their deal
 * - Activity tracking for automation
 * - Zero manual participant creation
 * - API-level access control enforced
 */

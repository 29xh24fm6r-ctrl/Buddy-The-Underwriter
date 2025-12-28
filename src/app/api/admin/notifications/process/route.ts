import { NextRequest, NextResponse } from "next/server";
import { processPendingNotifications } from "@/lib/notifications/processor";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/notifications/process
 * 
 * Processes all pending notifications in the queue.
 * Should be called by:
 * - Cron job (every 1-5 minutes)
 * - Manual trigger from admin panel
 * - After deal events that require immediate notification
 */
export async function POST(req: NextRequest) {
  try {
    // Require admin auth
    await requireSuperAdmin();

    const result = await processPendingNotifications();

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error: any) {
    console.error("Notification processing error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to process notifications" },
      { status: 500 }
    );
  }
}

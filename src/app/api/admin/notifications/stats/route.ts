import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/notifications/stats
 * 
 * Returns notification queue statistics
 */
export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin();

    const sb = supabaseAdmin();

    // Get counts by status
    const { data: stats } = await sb
      .from("notification_queue")
      .select("status")
      .then((res) => {
        const counts = {
          pending: 0,
          sent: 0,
          failed: 0,
          skipped: 0,
          total: 0,
        };

        res.data?.forEach((item: any) => {
          counts.total++;
          if (item.status === "pending") counts.pending++;
          else if (item.status === "sent") counts.sent++;
          else if (item.status === "failed") counts.failed++;
          else if (item.status === "skipped") counts.skipped++;
        });

        return { data: counts };
      });

    // Get recent failures
    const { data: recentFailures } = await sb
      .from("notification_queue")
      .select("id, notification_type, recipient, error_message, created_at")
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(10);

    return NextResponse.json({
      ok: true,
      stats: stats || { pending: 0, sent: 0, failed: 0, skipped: 0, total: 0 },
      recent_failures: recentFailures || [],
    });
  } catch (error: any) {
    console.error("Notification stats error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to fetch stats" },
      { status: 500 }
    );
  }
}

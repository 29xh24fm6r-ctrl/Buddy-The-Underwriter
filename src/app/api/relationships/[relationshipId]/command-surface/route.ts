import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildRelationshipUnifiedTimeline } from "@/core/relationship-surface/buildRelationshipUnifiedTimeline";
import { writeRelationshipSurfaceSnapshot } from "@/core/relationship-surface/writeRelationshipSurfaceSnapshot";
import type { RelationshipSurfaceItem } from "@/core/relationship-surface/types";

export const runtime = "nodejs";

type Params = Promise<{ relationshipId: string }>;

/**
 * GET /api/relationships/[relationshipId]/command-surface
 * Returns the full command surface for a single relationship.
 * Self-heals on read: loads snapshot, builds timeline, persists updated snapshot async.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { relationshipId } = await ctx.params;

    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();

    const { data: bu } = await sb
      .from("bank_users")
      .select("bank_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (!bu) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    // Load cached snapshot
    const { data: snapshot } = await sb
      .from("relationship_surface_snapshots")
      .select("surface_payload, computed_at")
      .eq("relationship_id", relationshipId)
      .eq("bank_id", bu.bank_id)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const item = snapshot?.surface_payload as unknown as RelationshipSurfaceItem | null;

    if (!item) {
      return NextResponse.json({
        item: null,
        timeline: [],
        computedAt: new Date().toISOString(),
      });
    }

    // Build unified timeline
    const timeline = await buildRelationshipUnifiedTimeline(
      relationshipId,
      bu.bank_id,
    );

    // Async persist updated snapshot (non-blocking)
    writeRelationshipSurfaceSnapshot(item).catch(() => {});

    return NextResponse.json({
      item,
      timeline,
      computedAt: item.computedAt,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

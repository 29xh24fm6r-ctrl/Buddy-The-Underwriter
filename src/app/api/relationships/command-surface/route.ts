import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildRelationshipSurfaceSummary } from "@/core/relationship-surface/buildRelationshipSurfaceSummary";
import type { RelationshipSurfaceItem } from "@/core/relationship-surface/types";

export const runtime = "nodejs";

/**
 * GET /api/relationships/command-surface
 * Returns the unified command surface for all relationships in the banker's bank.
 * Reads from cached snapshots for fast render; supports refresh=1 for recompute.
 */
export async function GET(req: NextRequest) {
  try {
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

    const { searchParams } = new URL(req.url);
    const priorityBucket = searchParams.get("priorityBucket");
    const reasonFamily = searchParams.get("reasonFamily");
    const changedOnly = searchParams.get("changedOnly") === "1";

    // Load cached snapshots
    let query = sb
      .from("relationship_surface_snapshots")
      .select("surface_payload, priority_bucket, priority_score, changed_since_viewed, computed_at")
      .eq("bank_id", bu.bank_id)
      .order("priority_score", { ascending: false })
      .limit(100);

    if (priorityBucket) {
      query = query.eq("priority_bucket", priorityBucket);
    }

    const { data: snapshots } = await query;

    let items: RelationshipSurfaceItem[] = (snapshots ?? [])
      .map((s) => s.surface_payload as unknown as RelationshipSurfaceItem)
      .filter(Boolean);

    if (reasonFamily) {
      items = items.filter((i) => i.primaryReasonFamily === reasonFamily);
    }
    if (changedOnly) {
      items = items.filter((i) => i.changedSinceViewed);
    }

    const response = buildRelationshipSurfaceSummary(
      items,
      new Date().toISOString(),
    );

    return NextResponse.json(response);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

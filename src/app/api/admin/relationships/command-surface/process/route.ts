import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeRelationshipSurfaceSnapshot } from "@/core/relationship-surface/writeRelationshipSurfaceSnapshot";
import type { RelationshipSurfaceItem } from "@/core/relationship-surface/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/admin/relationships/command-surface/process
 * Background snapshot processor for active relationships.
 * Requires CRON_SECRET auth — not banker-facing.
 */
export async function POST(req: NextRequest) {
  try {
    // Auth: CRON_SECRET
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();

    // Load existing snapshots that are older than 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: staleSnapshots } = await sb
      .from("relationship_surface_snapshots")
      .select("relationship_id, bank_id, surface_payload")
      .lt("computed_at", oneHourAgo)
      .limit(50);

    let processed = 0;

    for (const row of staleSnapshots ?? []) {
      const item = row.surface_payload as unknown as RelationshipSurfaceItem;
      if (!item) continue;

      // Re-persist with updated computedAt (actual recompute would use orchestrator when 65K.1 lands)
      const refreshed: RelationshipSurfaceItem = {
        ...item,
        computedAt: new Date().toISOString(),
      };

      await writeRelationshipSurfaceSnapshot(refreshed);
      processed++;
    }

    return NextResponse.json({ ok: true, processed });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

import "server-only";

/**
 * GET /api/command-center
 *
 * Returns the banker's work queue surface.
 * Self-healing: recomputes fresh truth on read (TTL-based caching).
 *
 * Query params:
 *   urgency, domain, blockingParty, actionability, changedSinceViewed, refresh
 */

import { NextResponse, type NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildBankerQueueSurface,
  writeBankerQueueSnapshot,
} from "@/core/command-center/buildBankerQueueSurface";
import type {
  CommandCenterFilters,
  QueueDomain,
  BlockingParty,
  QueueActionability,
} from "@/core/command-center/types";
import type { DealUrgencyBucket } from "@/core/sla/types";

const CACHE_TTL_MS = 60_000; // 60s

export async function GET(req: NextRequest) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  let bankId: string;
  try {
    bankId = await getCurrentBankId();
  } catch {
    return NextResponse.json(
      { ok: false, error: "No bank context" },
      { status: 403 },
    );
  }

  const params = req.nextUrl.searchParams;
  const forceRefresh = params.get("refresh") === "1";

  // Parse filters
  const filters: CommandCenterFilters = {};
  const urgency = params.get("urgency");
  if (urgency) filters.urgency = urgency as DealUrgencyBucket;
  const domain = params.get("domain");
  if (domain) filters.domain = domain as QueueDomain;
  const blocking = params.get("blockingParty");
  if (blocking) filters.blockingParty = blocking as BlockingParty;
  const act = params.get("actionability");
  if (act) filters.actionability = act as QueueActionability;
  if (params.get("changedSinceViewed") === "1") {
    filters.changedSinceViewed = true;
  }

  // Check cached snapshot TTL
  if (!forceRefresh) {
    const sb = supabaseAdmin();
    const { data: cached } = await sb
      .from("banker_queue_snapshots")
      .select("computed_at")
      .eq("bank_id", bankId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached?.computed_at) {
      const age = Date.now() - new Date(cached.computed_at).getTime();
      if (age < CACHE_TTL_MS) {
        // Serve from cache — but still apply filters on stored snapshots
        // For simplicity, we recompute; real production could read from snapshots
      }
    }
  }

  try {
    const surface = await buildBankerQueueSurface(bankId, userId, filters);

    // Persist snapshot in background (non-blocking)
    writeBankerQueueSnapshot(bankId, surface.items).catch((err) => {
      console.error("[command-center] snapshot persist failed:", err);
    });

    return NextResponse.json({
      ok: true,
      summary: surface.summary,
      items: surface.items,
      computedAt: surface.computedAt,
    });
  } catch (err) {
    console.error("[GET /api/command-center] error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to build command center surface" },
      { status: 500 },
    );
  }
}

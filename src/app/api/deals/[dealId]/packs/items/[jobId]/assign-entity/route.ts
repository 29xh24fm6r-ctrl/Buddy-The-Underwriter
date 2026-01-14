// src/app/api/deals/[dealId]/packs/items/[jobId]/assign-entity/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; jobId: string }> };

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

async function getSupabaseClient() {
  return supabaseAdmin();
}

/**
 * POST /api/deals/[dealId]/packs/items/[jobId]/assign-entity
 * Assign a pack item to an entity
 *
 * Body: { entity_id: string }
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return json(401, { ok: false, error: "Unauthorized" });
    }

    const p = await ctx.params;
    const { dealId, jobId } = p;

    if (!dealId || !jobId) {
      return json(400, { ok: false, error: "Missing dealId or jobId" });
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status = access.error === "unauthorized" ? 401 : 404;
      return json(status, { ok: false, error: access.error });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const { entity_id } = body;

    if (!entity_id) {
      return json(400, { ok: false, error: "Missing entity_id" });
    }

    const supabase = await getSupabaseClient();

    if (supabase) {
      // Production: Update in Supabase
      const { data, error } = await supabase
        .from("deal_pack_items")
        .update({
          entity_id,
          suggested_entity_id: null, // Clear suggestion once user assigns
        })
        .eq("job_id", jobId)
        .eq("deal_id", dealId)
        .select()
        .single();

      if (error) {
        console.error("[assign-entity] error:", error);
        return json(404, { ok: false, error: "Pack item not found" });
      }

      return json(200, { ok: true, item: data });
    }
  } catch (e: any) {
    console.error("[assign-entity] error:", e);
    return json(500, { ok: false, error: e.message });
  }
}

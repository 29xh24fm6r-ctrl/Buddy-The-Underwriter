// src/app/api/deals/[dealId]/packs/items/[jobId]/assign-entity/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

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
    const p = await ctx.params;
    const { dealId, jobId } = p;

    if (!dealId || !jobId) {
      return json(400, { ok: false, error: "Missing dealId or jobId" });
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
          updated_at: new Date().toISOString(),
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
    } else {
      // Development: Update job file
      const fs = await import("node:fs/promises");
      const path = await import("node:path");

      const jobPath = path.join("/tmp/buddy_ocr_jobs", dealId, `${jobId}.json`);

      try {
        const content = await fs.readFile(jobPath, "utf-8");
        const job = JSON.parse(content);

        // Add entity assignment to job metadata
        job.entity_id = entity_id;
        job.updated_at = new Date().toISOString();

        await fs.writeFile(jobPath, JSON.stringify(job, null, 2), "utf-8");

        return json(200, { ok: true, job });
      } catch (e: any) {
        console.error("[assign-entity] file error:", e);
        return json(404, { ok: false, error: "Job not found" });
      }
    }
  } catch (e: any) {
    console.error("[assign-entity] error:", e);
    return json(500, { ok: false, error: e.message });
  }
}

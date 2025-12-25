// src/app/api/deals/[dealId]/packs/items/[jobId]/suggest-entity/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import {
  suggestEntity,
  extractEntitySignals,
} from "@/lib/entities/entityMatching";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; jobId: string }> };

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

/**
 * POST /api/deals/[dealId]/packs/items/[jobId]/suggest-entity
 * Auto-suggest entity based on OCR content
 *
 * Returns: { suggestion: { entity_id, entity_name, confidence, reasons } | null }
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const p = await ctx.params;
    const { dealId, jobId } = p;

    if (!dealId || !jobId) {
      return json(400, { ok: false, error: "Missing dealId or jobId" });
    }

    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    // Load job
    const jobPath = path.join("/tmp/buddy_ocr_jobs", dealId, `${jobId}.json`);
    let job: any;

    try {
      const content = await fs.readFile(jobPath, "utf-8");
      job = JSON.parse(content);
    } catch {
      return json(404, { ok: false, error: "Job not found" });
    }

    // Load entities
    const entitiesDir = path.join(process.cwd(), ".data", "entities", dealId);
    let entities: any[] = [];

    try {
      await fs.mkdir(entitiesDir, { recursive: true });
      const files = await fs.readdir(entitiesDir);

      entities = await Promise.all(
        files
          .filter((f) => f.endsWith(".json"))
          .map(async (file) => {
            const content = await fs.readFile(
              path.join(entitiesDir, file),
              "utf-8",
            );
            return JSON.parse(content);
          }),
      );
    } catch (e) {
      console.error("[suggest-entity] error loading entities:", e);
    }

    // Extract signals from OCR if not already done
    if (!job.meta?.detected_eins && job.result?.ocr) {
      const signals = extractEntitySignals(job.result.ocr);
      job.meta = {
        ...job.meta,
        ...signals,
      };

      // Save updated job
      await fs.writeFile(jobPath, JSON.stringify(job, null, 2), "utf-8");
    }

    // Convert job to PackItem format for matching
    const packItem = {
      id: jobId,
      job_id: jobId,
      deal_id: dealId,
      user_id: "dev-user",
      stored_name: job.stored_name,
      status: job.status,
      ocr_result: job.result?.ocr,
      classification: job.result?.classification,
      meta: job.meta || {},
      created_at: job.created_at,
      updated_at: job.updated_at,
    };

    // Get suggestion
    const suggestion = suggestEntity(packItem, entities);

    return json(200, {
      ok: true,
      suggestion,
      signals: {
        detected_eins: job.meta?.detected_eins || [],
        detected_names: job.meta?.detected_names || [],
      },
    });
  } catch (e: any) {
    console.error("[suggest-entity] error:", e);
    return json(500, { ok: false, error: e.message });
  }
}

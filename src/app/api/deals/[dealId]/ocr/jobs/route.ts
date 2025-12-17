// src/app/api/deals/[dealId]/ocr/jobs/route.ts
import "server-only";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> | { dealId: string } };

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function GET(req: Request, { params }: Ctx) {
  try {
    const p = params instanceof Promise ? await params : params;
    const dealId = p?.dealId;

    if (!dealId) return json(400, { ok: false, error: "Missing dealId" });

    const url = new URL(req.url);
    const jobId = url.searchParams.get("job_id");

    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const jobsDir = path.join("/tmp/buddy_ocr_jobs", dealId);

    // ✅ If job_id is provided, return that single job
    if (jobId) {
      const jobPath = path.join(jobsDir, `${jobId}.json`);
      try {
        const raw = await fs.readFile(jobPath, "utf-8");
        const job = JSON.parse(raw);
        return json(200, { ok: true, deal_id: dealId, job });
      } catch (e: any) {
        // Important: return 404 but keep it explicit
        return json(404, {
          ok: false,
          error: `Job not found: ${jobId}`,
        });
      }
    }

    // ✅ Otherwise, list all jobs newest-first
    let names: string[] = [];
    try {
      names = await fs.readdir(jobsDir);
    } catch {
      names = [];
    }

    const jobs = await Promise.all(
      names
        .filter((n) => n.endsWith(".json"))
        .map(async (name) => {
          const full = path.join(jobsDir, name);
          const raw = await fs.readFile(full, "utf-8");
          return JSON.parse(raw);
        })
    );

    jobs.sort((a, b) => {
      const au = String(a?.updated_at ?? "");
      const bu = String(b?.updated_at ?? "");
      return au < bu ? 1 : -1;
    });

    return json(200, { ok: true, deal_id: dealId, jobs });
  } catch (e: any) {
    return json(500, { ok: false, error: String(e?.message || e) });
  }
}

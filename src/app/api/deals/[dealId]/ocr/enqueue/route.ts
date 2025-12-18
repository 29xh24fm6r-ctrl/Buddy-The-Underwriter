// src/app/api/deals/[dealId]/ocr/enqueue/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> | { dealId: string } };

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const p = params instanceof Promise ? await params : params;
    const dealId = p?.dealId;

    if (!dealId) {
      return json(400, { ok: false, error: "Missing dealId" });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const storedName = body?.file_name;
    const packId = body?.pack_id;
    if (!storedName || typeof storedName !== "string") {
      return json(400, { ok: false, error: "Missing file_name" });
    }

    const jobId = randomUUID();

    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const jobsDir = path.join("/tmp/buddy_ocr_jobs", dealId);
    await fs.mkdir(jobsDir, { recursive: true });

    const job = {
      job_id: jobId,
      deal_id: dealId,
      stored_name: storedName, // 🔑 THIS IS THE FIX
      pack_id: packId,
      status: "queued",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      result: null,
      error: null,
    };

    const jobPath = path.join(jobsDir, `${jobId}.json`);
    await fs.writeFile(jobPath, JSON.stringify(job, null, 2), "utf-8");

    return json(200, {
      ok: true,
      job_id: jobId,
    });
  } catch (e: any) {
    return json(500, {
      ok: false,
      error: e?.message ?? String(e),
    });
  }
}

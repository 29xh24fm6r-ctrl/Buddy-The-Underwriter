// src/app/api/deals/[dealId]/ocr/run/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { runOcrJob } from "@/lib/ocr/runOcrJob";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function safeError(e: any) {
  return {
    name: e?.name ?? "Error",
    message: e?.message ?? String(e),
    stack: e?.stack ?? null,
    code: e?.code ?? null,
  };
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const reqId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const startedAt = Date.now();

  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return json(401, { ok: false, error: { message: "Unauthorized" } });
    }

    const p = await ctx.params;
    const dealId = p?.dealId;

    if (!dealId) {
      return json(400, { ok: false, error: { message: "Missing dealId" } });
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status = access.error === "unauthorized" ? 401 : 404;
      return json(status, { ok: false, error: { message: access.error } });
    }

    let body: any = null;
    try {
      body = await req.json();
    } catch {
      return json(400, { ok: false, error: { message: "Invalid JSON body" } });
    }

    const jobId = body?.job_id;
    if (!jobId || typeof jobId !== "string") {
      return json(400, { ok: false, error: { message: "Missing job_id" } });
    }

    console.log(`[ocr/run ${reqId}] start`, { dealId, jobId });

    const result = await runOcrJob({ dealId, jobId, reqId });

    console.log(`[ocr/run ${reqId}] success`, {
      dealId,
      jobId,
      elapsedMs: Date.now() - startedAt,
    });

    return json(200, { ok: true, result });
  } catch (e: any) {
    const err = safeError(e);
    console.error(`[ocr/run ${reqId}] FAIL`, err);

    return json(500, {
      ok: false,
      error: { message: err.message },
      debug: {
        reqId,
        name: err.name,
        code: err.code,
        elapsedMs: Date.now() - startedAt,
        stack: process.env.NODE_ENV !== "production" ? err.stack : null,
      },
    });
  }
}

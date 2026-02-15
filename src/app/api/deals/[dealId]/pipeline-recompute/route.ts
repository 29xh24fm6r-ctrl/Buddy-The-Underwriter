import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { enqueueSpreadRecompute } from "@/lib/financialSpreads/enqueueSpreadRecompute";
import { ALL_SPREAD_TYPES } from "@/lib/financialSpreads/types";
import { logPipelineLedger } from "@/lib/pipeline/logPipelineLedger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

const VALID_SCOPES = new Set(["ALL", "DOCS", "EXTRACT", "SPREADS"]);

/**
 * POST /api/deals/[dealId]/pipeline-recompute?scope=ALL|DOCS|EXTRACT|SPREADS
 *
 * Scoped pipeline recompute: re-enqueue pipeline jobs based on scope.
 * Super-admin only.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    await requireRoleApi(["super_admin"]);

    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const url = new URL(req.url);
    const scope = (url.searchParams.get("scope") ?? "ALL").toUpperCase();
    if (!VALID_SCOPES.has(scope)) {
      return NextResponse.json(
        { ok: false, error: `Invalid scope: ${scope}. Must be one of: ${[...VALID_SCOPES].join(", ")}` },
        { status: 400 },
      );
    }

    const sb = supabaseAdmin();
    const counts: Record<string, number> = {};

    // ── DOCS scope: re-enqueue OCR + CLASSIFY for docs missing results ──
    if (scope === "ALL" || scope === "DOCS") {
      const { data: docs } = await sb
        .from("deal_documents")
        .select("id, document_type")
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId);

      const allDocs = docs ?? [];
      const docIds = allDocs.map((d: any) => String(d.id));

      let existingJobs: Array<{ attachment_id: string; job_type: string; status: string }> = [];
      if (docIds.length > 0) {
        const { data: jobs } = await sb
          .from("document_jobs")
          .select("attachment_id, job_type, status")
          .in("attachment_id", docIds);
        existingJobs = (jobs ?? []) as typeof existingJobs;
      }

      const jobLookup = new Map<string, string>();
      for (const j of existingJobs) {
        jobLookup.set(`${j.attachment_id}:${j.job_type}`, j.status);
      }

      let ocrEnqueued = 0;
      let classifyEnqueued = 0;

      for (const doc of allDocs) {
        const docId = String(doc.id);

        // Re-enqueue OCR if no SUCCEEDED OCR job exists
        const ocrStatus = jobLookup.get(`${docId}:OCR`);
        if (!ocrStatus || ocrStatus === "FAILED") {
          const { error } = await (sb as any).from("document_jobs").upsert(
            {
              deal_id: dealId,
              attachment_id: docId,
              job_type: "OCR",
              status: "QUEUED",
              next_run_at: new Date().toISOString(),
            },
            { onConflict: "attachment_id,job_type" },
          );
          if (!error) ocrEnqueued++;
        }

        // Re-enqueue CLASSIFY if doc has OCR but no document_type
        const classifyStatus = jobLookup.get(`${docId}:CLASSIFY`);
        if (
          (doc as any).document_type == null &&
          ocrStatus === "SUCCEEDED" &&
          (!classifyStatus || classifyStatus === "FAILED")
        ) {
          const { error } = await (sb as any).from("document_jobs").upsert(
            {
              deal_id: dealId,
              attachment_id: docId,
              job_type: "CLASSIFY",
              status: "QUEUED",
              next_run_at: new Date().toISOString(),
            },
            { onConflict: "attachment_id,job_type" },
          );
          if (!error) classifyEnqueued++;
        }
      }

      counts.ocr = ocrEnqueued;
      counts.classify = classifyEnqueued;
    }

    // ── EXTRACT scope: re-enqueue for classified docs missing extract ──
    if (scope === "ALL" || scope === "EXTRACT") {
      const { data: classifiedDocs } = await sb
        .from("deal_documents")
        .select("id")
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId)
        .not("document_type", "is", null);

      const classifiedIds = (classifiedDocs ?? []).map((d: any) => String(d.id));
      let extractEnqueued = 0;

      if (classifiedIds.length > 0) {
        const { data: extractJobs } = await sb
          .from("document_jobs")
          .select("attachment_id, status")
          .in("attachment_id", classifiedIds)
          .eq("job_type", "EXTRACT");

        const extractStatusMap = new Map<string, string>();
        for (const j of (extractJobs ?? []) as Array<{ attachment_id: string; status: string }>) {
          extractStatusMap.set(j.attachment_id, j.status);
        }

        for (const docId of classifiedIds) {
          const status = extractStatusMap.get(docId);
          if (!status || status === "FAILED") {
            const { error } = await (sb as any).from("document_jobs").upsert(
              {
                deal_id: dealId,
                attachment_id: docId,
                job_type: "EXTRACT",
                status: "QUEUED",
                next_run_at: new Date().toISOString(),
              },
              { onConflict: "attachment_id,job_type" },
            );
            if (!error) extractEnqueued++;
          }
        }
      }

      counts.extract = extractEnqueued;
    }

    // ── SPREADS scope: call existing enqueueSpreadRecompute ──
    if (scope === "ALL" || scope === "SPREADS") {
      const res = await enqueueSpreadRecompute({
        dealId,
        bankId: access.bankId,
        spreadTypes: [...ALL_SPREAD_TYPES],
        meta: { source: "pipeline_recompute_api", scope, requested_at: new Date().toISOString() },
      });
      counts.spreads = res.ok && (res as any).enqueued ? 1 : 0;
    }

    // Write ledger event
    await logPipelineLedger(sb, {
      bank_id: access.bankId,
      deal_id: dealId,
      event_key: "pipeline_recompute",
      status: "ok",
      payload: { scope, counts },
    });

    return NextResponse.json({ ok: true, dealId, scope, counts });
  } catch (e: any) {
    rethrowNextErrors(e);

    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }

    console.error("[/api/deals/[dealId]/pipeline-recompute]", e);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/pipeline-status
 *
 * Aggregated pipeline observability endpoint.
 * Counts + timestamps for: documents, jobs (OCR/CLASSIFY/EXTRACT/SPREADS),
 * facts, spreads, and last 25 ledger events.
 * Banker-auth via ensureDealBankAccess.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);

    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();

    // 6 parallel queries — counts + timestamps, no heavy joins.
    const [docsRes, docJobsRes, spreadJobsRes, factsRes, spreadsRes, ledgerRes] =
      await Promise.all([
        // 1. deal_documents summary
        sb
          .from("deal_documents")
          .select(
            "id, document_type, gatekeeper_needs_review, created_at",
          )
          .eq("deal_id", dealId)
          .eq("bank_id", access.bankId),

        // 2. document_jobs by job_type + status
        sb
          .from("document_jobs")
          .select("job_type, status")
          .eq("deal_id", dealId),

        // 3. deal_spread_jobs by status
        (sb as any)
          .from("deal_spread_jobs")
          .select("status, created_at")
          .eq("deal_id", dealId)
          .eq("bank_id", access.bankId),

        // 4. deal_financial_facts count + max created_at
        sb
          .from("deal_financial_facts")
          .select("id, created_at")
          .eq("deal_id", dealId)
          .eq("bank_id", access.bankId),

        // 5. deal_spreads summary
        (sb as any)
          .from("deal_spreads")
          .select("spread_type, status, updated_at")
          .eq("deal_id", dealId)
          .eq("bank_id", access.bankId),

        // 6. deal_pipeline_ledger — last 25
        sb
          .from("deal_pipeline_ledger")
          .select("stage, event_key, status, payload, ui_state, ui_message, created_at")
          .eq("deal_id", dealId)
          .eq("bank_id", access.bankId)
          .order("created_at", { ascending: false })
          .limit(25),
      ]);

    // ── 1. Documents ──
    const docs = (docsRes.data ?? []) as Array<{
      id: string;
      document_type: string | null;
      gatekeeper_needs_review: boolean | null;
      created_at: string;
    }>;
    const docsTotal = docs.length;
    const docsClassified = docs.filter((d) => d.document_type != null).length;
    const docsNeedsReview = docs.filter((d) => d.gatekeeper_needs_review === true).length;
    const docsLastUploadedAt = docs.length
      ? docs.reduce((max, d) => (d.created_at > max ? d.created_at : max), docs[0].created_at)
      : null;

    // ── 2. Document jobs (OCR / CLASSIFY / EXTRACT) ──
    type JobBucket = { queued: number; running: number; succeeded: number; failed: number };
    const emptyBucket = (): JobBucket => ({ queued: 0, running: 0, succeeded: 0, failed: 0 });
    const jobsByType: Record<string, JobBucket> = {
      OCR: emptyBucket(),
      CLASSIFY: emptyBucket(),
      EXTRACT: emptyBucket(),
    };
    for (const j of (docJobsRes.data ?? []) as Array<{ job_type: string; status: string }>) {
      const bucket = jobsByType[j.job_type] ?? (jobsByType[j.job_type] = emptyBucket());
      const s = j.status.toUpperCase();
      if (s === "QUEUED") bucket.queued++;
      else if (s === "RUNNING") bucket.running++;
      else if (s === "SUCCEEDED") bucket.succeeded++;
      else if (s === "FAILED") bucket.failed++;
    }

    // ── 3. Spread jobs ──
    const spreadJobs = emptyBucket();
    for (const j of ((spreadJobsRes as any).data ?? []) as Array<{ status: string }>) {
      const s = j.status.toUpperCase();
      if (s === "QUEUED") spreadJobs.queued++;
      else if (s === "RUNNING") spreadJobs.running++;
      else if (s === "SUCCEEDED") spreadJobs.succeeded++;
      else if (s === "FAILED") spreadJobs.failed++;
    }

    // ── 4. Facts ──
    const facts = (factsRes.data ?? []) as Array<{ id: string; created_at: string }>;
    const factsTotal = facts.length;
    const factsLastCreatedAt = facts.length
      ? facts.reduce((max, f) => (f.created_at > max ? f.created_at : max), facts[0].created_at)
      : null;

    // ── 5. Spreads ──
    const spreadRows = ((spreadsRes as any).data ?? []) as Array<{
      spread_type: string;
      status: string;
      updated_at: string;
    }>;
    const spreadTypes = Array.from(new Set(spreadRows.map((r) => r.spread_type)));
    let spreadsReady = 0;
    let spreadsGenerating = 0;
    let spreadsError = 0;
    for (const r of spreadRows) {
      if (r.status === "ready") spreadsReady++;
      else if (r.status === "generating") spreadsGenerating++;
      else if (r.status === "error") spreadsError++;
    }
    const spreadsLastUpdatedAt = spreadRows.length
      ? spreadRows.reduce(
          (max, r) => (r.updated_at > max ? r.updated_at : max),
          spreadRows[0].updated_at,
        )
      : null;

    // ── 6. Ledger (already sorted by query) ──
    const ledger = ((ledgerRes.data ?? []) as Array<{
      stage: string;
      event_key: string | null;
      status: string;
      payload: any;
      ui_state: string | null;
      ui_message: string | null;
      created_at: string;
    }>).map((e) => ({
      stage: e.stage,
      event_key: e.event_key ?? null,
      status: e.status,
      payload: e.payload ?? null,
      ui_state: e.ui_state ?? null,
      ui_message: e.ui_message ?? null,
      created_at: e.created_at,
    }));

    return NextResponse.json({
      ok: true,
      dealId,
      docs: {
        total: docsTotal,
        classified: docsClassified,
        needsReview: docsNeedsReview,
        lastUploadedAt: docsLastUploadedAt,
      },
      jobs: {
        ocr: jobsByType.OCR,
        classify: jobsByType.CLASSIFY,
        extract: jobsByType.EXTRACT,
        spreads: spreadJobs,
      },
      facts: {
        total: factsTotal,
        lastCreatedAt: factsLastCreatedAt,
      },
      spreads: {
        types: spreadTypes,
        ready: spreadsReady,
        generating: spreadsGenerating,
        error: spreadsError,
        lastUpdatedAt: spreadsLastUpdatedAt,
      },
      ledger,
    });
  } catch (e: any) {
    rethrowNextErrors(e);

    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }

    console.error("[/api/deals/[dealId]/pipeline-status]", e);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}

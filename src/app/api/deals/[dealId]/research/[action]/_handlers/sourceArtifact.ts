import "server-only";
import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const maxDuration = 10;

type Params = Promise<{ dealId: string }>;

/**
 * GET /api/deals/[dealId]/research/source-artifact?artifact_id=...
 * SPEC-BIE-SOURCE-SNAPSHOT-TO-LOAN-FILE-ARTIFACT-1
 *
 * Banker-openable durable loan-file artifact (captured public-source evidence
 * receipt). Consolidated dispatcher handler (no new serverless function).
 * Read-only. With ?format=json returns metadata; otherwise serves the stored
 * HTML receipt (independent of the live website). The artifact is verified to
 * belong to the URL dealId.
 */
export async function GET(req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const url = new URL(req.url);
    const artifactId = url.searchParams.get("artifact_id") ?? "";
    if (!artifactId) {
      return NextResponse.json({ ok: false, error: "artifact_id_required" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const { data: artifact } = await sb
      .from("buddy_research_source_artifacts")
      .select(
        "id, deal_id, mission_id, source_snapshot_id, task_id, artifact_type, title, source_url, source_type, source_domain, connector_kind, connector_mode, http_status, content_hash, captured_at, status, artifact_html, excerpt, limitations, review_status, created_at",
      )
      .eq("id", artifactId)
      .eq("deal_id", dealId)
      .maybeSingle();

    if (!artifact) {
      return NextResponse.json({ ok: false, error: "artifact_not_found" }, { status: 404 });
    }

    const fmt = (url.searchParams.get("format") ?? "").toLowerCase();
    if (fmt === "json") {
      const { artifact_html, ...meta } = artifact as any;
      void artifact_html;
      return NextResponse.json({ ok: true, artifact: meta });
    }

    // SPEC-BIE-COMMITTEE-READINESS-FINAL-UX-POLISH-AND-PDF-ARTIFACTS-1 Phase 2:
    // serve a PDF receipt (generated on demand from the durable columns via
    // pdf-lib — no headless browser). HTML stays the default fallback.
    if (fmt === "pdf") {
      const a = artifact as any;
      const { renderSourceArtifactPdf } = await import("@/lib/research/sourceArtifactPdf");
      const bytes = await renderSourceArtifactPdf({
        dealId: a.deal_id,
        missionId: a.mission_id,
        sourceSnapshotId: a.source_snapshot_id,
        taskId: a.task_id,
        title: a.title,
        sourceUrl: a.source_url,
        sourceType: a.source_type,
        sourceDomain: a.source_domain,
        connectorKind: a.connector_kind,
        connectorMode: a.connector_mode,
        httpStatus: a.http_status,
        contentHash: a.content_hash,
        capturedAt: a.captured_at,
        reviewStatus: a.review_status,
        limitations: Array.isArray(a.limitations) ? a.limitations : [],
        excerpt: a.excerpt,
      });
      return new NextResponse(Buffer.from(bytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="captured-source-${artifactId}.pdf"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    return new NextResponse((artifact as any).artifact_html ?? "", {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unexpected_error" },
      { status: 500 },
    );
  }
}

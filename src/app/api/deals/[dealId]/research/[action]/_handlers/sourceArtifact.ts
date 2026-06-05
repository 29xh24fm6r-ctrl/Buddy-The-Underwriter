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
        "id, deal_id, mission_id, source_snapshot_id, task_id, artifact_type, title, source_url, source_type, source_domain, connector_kind, connector_mode, http_status, content_hash, captured_at, status, artifact_html, excerpt, limitations, review_status, created_at, " +
          "official_capture_available, official_capture_format, official_capture_status, official_capture_hash, official_capture_url, official_capture_limitations, official_capture_content, official_capture_content_encoding, receipt_pdf_available",
      )
      .eq("id", artifactId)
      .eq("deal_id", dealId)
      .maybeSingle();

    if (!artifact) {
      return NextResponse.json({ ok: false, error: "artifact_not_found" }, { status: 404 });
    }

    const fmt = (url.searchParams.get("format") ?? "").toLowerCase();
    const a = artifact as any;

    if (fmt === "json") {
      // Strip the heavy inline blobs; keep all capture-provenance metadata so the
      // UI can label "Official capture" vs "Buddy receipt".
      const { artifact_html, official_capture_content, ...meta } = a;
      void artifact_html;
      void official_capture_content;
      return NextResponse.json({ ok: true, artifact: meta });
    }

    // SPEC-…-OFFICIAL-PDF-CAPTURE-1 Phase 1: serve the ACTUAL captured official
    // source (distinct from the Buddy receipt). Never misrepresents a receipt as
    // the official document; returns 409 with limitations when none was captured.
    if (fmt === "official" || (url.searchParams.get("capture") ?? "") === "official") {
      const content: string | null = a.official_capture_content ?? null;
      if (!content) {
        return NextResponse.json(
          {
            ok: false,
            error: "official_capture_unavailable",
            official_capture_status: a.official_capture_status ?? "none",
            official_capture_limitations: Array.isArray(a.official_capture_limitations)
              ? a.official_capture_limitations
              : [],
            receipt_available: a.receipt_pdf_available ?? true,
            hint: "Open the Buddy receipt (format=pdf|html) instead, or attach the official source.",
          },
          { status: 409 },
        );
      }
      const encoding = a.official_capture_content_encoding ?? "utf8";
      if (encoding === "base64") {
        return new NextResponse(Buffer.from(content, "base64"), {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="official-capture-${artifactId}.pdf"`,
            "X-Content-Type-Options": "nosniff",
            "X-Buddy-Artifact-Kind": "official-capture",
          },
        });
      }
      return new NextResponse(content, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "X-Buddy-Artifact-Kind": "official-capture",
        },
      });
    }

    // SPEC-BIE-COMMITTEE-READINESS-FINAL-UX-POLISH-AND-PDF-ARTIFACTS-1 Phase 2:
    // serve a PDF receipt (generated on demand from the durable columns via
    // pdf-lib — no headless browser). HTML stays the default fallback.
    if (fmt === "pdf") {
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

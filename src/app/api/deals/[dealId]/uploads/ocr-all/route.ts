// src/app/api/deals/[dealId]/uploads/ocr-all/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OCR_MIME_OK = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/tiff",
  "image/bmp",
  "image/webp",
]);

type Ctx = { params: Promise<{ dealId: string }> | { dealId: string } };

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

/**
 * POST /api/deals/[dealId]/uploads/ocr-all
 * 
 * Enqueue OCR jobs for all eligible uploads (durable Postgres queue)
 * Replaces /tmp fragility with race-proof DB-backed jobs
 * 
 * Returns: { ok: true, enqueued: number, already_queued: number, skipped: number }
 */
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const p = params instanceof Promise ? await params : params;
    const dealId = p?.dealId;

    if (!dealId) return json(400, { ok: false, error: "Missing dealId" });

    const supabase = supabaseAdmin();

    // Fetch all attachments for deal
    const { data: attachments, error: e1 } = await (supabase as any)
      .from("borrower_attachments")
      .select("id, stored_name, mime_type, application_id")
      .eq("application_id", dealId);

    if (e1) throw e1;

    if (!attachments || attachments.length === 0) {
      return json(200, {
        ok: true,
        enqueued: 0,
        already_queued: 0,
        skipped: 0,
        reason: "no_attachments",
      });
    }

    // Filter to OCR-eligible files
    const eligible = attachments.filter((a: any) => OCR_MIME_OK.has(a.mime_type));

    if (eligible.length === 0) {
      return json(200, {
        ok: true,
        enqueued: 0,
        already_queued: 0,
        skipped: attachments.length,
        reason: "no_eligible_files",
      });
    }

    let enqueued = 0;
    let already_queued = 0;

    // Upsert jobs (idempotent via UNIQUE constraint on attachment_id,job_type)
    for (const attachment of eligible) {
      const { error: insertErr } = await (supabase as any)
        .from("document_jobs")
        .upsert(
          {
            deal_id: dealId,
            attachment_id: attachment.id,
            job_type: "OCR",
            status: "QUEUED",
            next_run_at: new Date().toISOString(),
          },
          { onConflict: "attachment_id,job_type", ignoreDuplicates: true }
        );

      if (insertErr) {
        // Constraint violation = already exists
        if (insertErr.code === "23505") {
          already_queued++;
        } else {
          throw insertErr;
        }
      } else {
        enqueued++;
      }
    }

    return json(200, {
      ok: true,
      enqueued,
      already_queued,
      skipped: attachments.length - eligible.length,
      total_eligible: eligible.length,
    });
  } catch (err: any) {
    return json(500, { ok: false, error: err?.message ?? String(err) });
  }
}

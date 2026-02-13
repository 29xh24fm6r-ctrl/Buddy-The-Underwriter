import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/deals/[dealId]/documents
 *
 * Compatibility endpoint for legacy/simple UIs.
 * Returns the canonical documents for a deal from deal_documents.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  await requireRole(["super_admin", "bank_admin", "underwriter"]);

  const { dealId } = await ctx.params;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    const status = access.error === "unauthorized" ? 401 : 404;
    return NextResponse.json(
      { ok: false, error: access.error },
      { status },
    );
  }

  const sb = supabaseAdmin();

  // Parallel fetch: documents + artifact pipeline status.
  // NOTE on null-safe querying: PostgREST `.neq(col, val)` excludes rows
  // where col IS NULL. If you ever add `.neq()` on a nullable column, use:
  //   query.or('col.is.null,col.neq.VALUE')
  const [docResult, artifactResult] = await Promise.all([
    sb
      .from("deal_documents")
      .select(
        "id, deal_id, bank_id, original_filename, display_name, naming_method, document_type, doc_year, mime_type, size_bytes, checklist_key, created_at, storage_bucket, storage_path, source, canonical_type, routing_class, classification_confidence, finalized_at, virus_status, entity_name, match_confidence, match_source",
      )
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .order("created_at", { ascending: false })
      .limit(500),
    sb
      .from("document_artifacts")
      .select("source_id, status, error_message")
      .eq("deal_id", dealId)
      .eq("source_table", "deal_documents"),
  ]);

  const { data, error } = docResult;

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  // Build artifact status lookup: source_id → latest status
  const artifactMap = new Map<string, { status: string; error: string | null }>();
  for (const a of artifactResult.data ?? []) {
    artifactMap.set(a.source_id, { status: a.status, error: a.error_message });
  }

  const documents = (data ?? []).map((d: any) => {
    const artifact = artifactMap.get(d.id);
    return {
      id: String(d.id),
      deal_id: d.deal_id,
      bank_id: d.bank_id,
      name: d.display_name ?? d.original_filename,
      display_name: d.display_name ?? d.original_filename,
      original_filename: d.original_filename,
      document_type: d.document_type ?? null,
      doc_year: d.doc_year ?? null,
      naming_method: d.naming_method ?? null,
      mime_type: d.mime_type,
      size_bytes: d.size_bytes,
      checklist_key: d.checklist_key ?? null,
      uploadedAt: d.created_at,
      created_at: d.created_at,
      storage_bucket: d.storage_bucket,
      storage_path: d.storage_path,
      source: d.source,
      canonical_type: d.canonical_type ?? null,
      routing_class: d.routing_class ?? null,
      classification_confidence: d.classification_confidence ?? null,
      finalized_at: d.finalized_at ?? null,
      virus_status: d.virus_status ?? null,
      entity_name: d.entity_name ?? null,
      match_confidence: d.match_confidence ?? null,
      match_source: d.match_source ?? null,
      artifact_status: artifact?.status ?? null,
      artifact_error: artifact?.error ?? null,
    };
  });

  return NextResponse.json({ ok: true, documents });
}

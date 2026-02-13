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

  const { data, error } = await sb
    .from("deal_documents")
    .select(
      "id, deal_id, bank_id, original_filename, display_name, naming_method, document_type, doc_year, mime_type, size_bytes, checklist_key, created_at, storage_bucket, storage_path, source, canonical_type, routing_class, classification_confidence, finalized_at, virus_status, entity_name",
    )
    .eq("deal_id", dealId)
    .eq("bank_id", access.bankId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  const documents = (data ?? []).map((d: any) => ({
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
    checklist_key: d.checklist_key,
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
  }));

  return NextResponse.json({ ok: true, documents });
}

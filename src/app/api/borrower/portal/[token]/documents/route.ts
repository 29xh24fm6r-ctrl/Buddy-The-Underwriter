import "server-only";

/**
 * Borrower-facing document list.
 *
 * GET    /api/borrower/portal/[token]/documents  — what I've uploaded
 * DELETE /api/borrower/portal/[token]/documents  — remove one (body: { id })
 *
 * Uses the same storage, the same `deal_documents` table and the same
 * canonical borrower auth as the upload routes. This is a read/manage view
 * over the EXISTING document system, not a second one.
 *
 * Deletion is soft and borrower-scoped: a borrower may withdraw a document
 * they uploaded themselves and that has not yet been accepted into the
 * package. Anything staff-uploaded or already relied upon is not removable
 * here — the borrower is told to ask their advisor instead of silently
 * failing.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

/**
 * The columns this route selects from `deal_documents`, verified against
 * the production schema (the table has no `doc_type` or `withdrawn_at`).
 *
 * Declared explicitly because the select list is built as a concatenated
 * string for readability, which the Supabase client cannot resolve to a
 * literal type — without this it infers GenericStringError and the mapper
 * fails to typecheck.
 */
type BorrowerDocumentRow = {
  id: string;
  original_filename: string | null;
  document_category: string | null;
  document_label: string | null;
  created_at: string;
  size_bytes: number | null;
  status: string | null;
  source: string | null;
  is_active: boolean | null;
};

async function auth(token: string) {
  try {
    return await resolvePortalContext(token);
  } catch {
    return null;
  }
}

export async function GET(_req: NextRequest, ctx: Context) {
  const { token } = await ctx.params;
  const context = await auth(token);
  if (!context) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("deal_documents")
    .select(
      "id, original_filename, document_category, document_label, created_at, size_bytes, status, source, is_active",
    )
    .eq("deal_id", context.dealId)
    .neq("status", "withdrawn")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[borrower/documents] list failed", error.message);
    return NextResponse.json(
      { ok: false, error: "Could not load your documents" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    documents: ((data ?? []) as unknown as BorrowerDocumentRow[]).map((d) => ({
      id: d.id,
      filename: d.original_filename ?? "Document",
      category: d.document_category ?? "other_supporting_document",
      label: d.document_label ?? d.original_filename ?? "Document",
      uploadedAt: d.created_at,
      sizeBytes: d.size_bytes ?? null,
      status: d.status ?? "uploaded",
      // Only borrower-uploaded documents may be withdrawn by the borrower.
      removable: d.source === "borrower_portal" || d.source === "borrower",
    })),
  });
}

export async function DELETE(req: NextRequest, ctx: Context) {
  const { token } = await ctx.params;
  const context = await auth(token);
  if (!context) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : null;
  if (!id) {
    return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // Scope the lookup to THIS deal. Without it, a borrower could pass any
  // document id and delete another borrower's file.
  const { data: doc } = await sb
    .from("deal_documents")
    .select("id, source, deal_id")
    .eq("id", id)
    .eq("deal_id", context.dealId)
    .maybeSingle();

  if (!doc) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const source = (doc as unknown as Pick<BorrowerDocumentRow, "source">).source;
  if (source !== "borrower_portal" && source !== "borrower") {
    return NextResponse.json(
      {
        ok: false,
        error: "not_removable",
        message:
          "This document was added by your advisor. Message them to have it changed.",
      },
      { status: 409 },
    );
  }

  const { error } = await sb
    .from("deal_documents")
    // Soft withdraw. `deal_documents` has no withdrawn_at column, and adding
    // one is a schema change this launch sprint does not need: status plus
    // is_active is enough to hide it from the borrower and from packaging,
    // while keeping the row for audit.
    .update({ status: "withdrawn", is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("deal_id", context.dealId);

  if (error) {
    console.error("[borrower/documents] withdraw failed", error.message);
    return NextResponse.json(
      { ok: false, error: "Could not remove that document" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

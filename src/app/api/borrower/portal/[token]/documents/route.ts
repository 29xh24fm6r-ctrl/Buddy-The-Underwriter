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
import { collapseDuplicateDocuments } from "@/lib/documents/collapseDuplicateDocuments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

/**
 * The columns this route selects from `deal_documents`.
 *
 * Every column here is defined by a migration. An earlier revision selected
 * `document_category`, `document_label` and `is_active`: those exist in the
 * production database but NO migration adds them to this table
 * (`document_category`/`document_label` are added to `deal_checklist_items`
 * by 20260106_prod_checklist_columns_safe.sql — a different table), so they
 * are undeclared schema drift. Selecting them would 400 in any environment
 * built from migrations, which is exactly what `gate:schema-select` exists
 * to prevent.
 *
 * They were also the wrong fields regardless: `ingestDocument.ts` — the
 * canonical writer, with its own ALLOWED_COLUMNS guard — never populates
 * any of the three, so they are null on every borrower upload.
 * `checklist_key` is what the uploader actually stamps when a borrower
 * picks a document category.
 *
 * Declared explicitly because the Supabase client cannot resolve this
 * select to a literal type, and without it the mapper infers
 * GenericStringError and fails to typecheck.
 */
type BorrowerDocumentRow = {
  id: string;
  original_filename: string | null;
  checklist_key: string | null;
  created_at: string;
  size_bytes: number | null;
  sha256: string | null;
  status: string | null;
  source: string | null;
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
      "id, original_filename, checklist_key, created_at, size_bytes, sha256, status, source",
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

  const documents = ((data ?? []) as unknown as BorrowerDocumentRow[]).map((d) => ({
    id: d.id,
    filename: d.original_filename ?? "Document",
    category: d.checklist_key ?? "other_supporting_document",
    label: d.original_filename ?? "Document",
    uploadedAt: d.created_at,
    sizeBytes: d.size_bytes ?? null,
    sha256: d.sha256 ?? null,
    status: d.status ?? "uploaded",
    // Only borrower-uploaded documents may be withdrawn by the borrower.
    removable: d.source === "borrower_portal" || d.source === "borrower",
  }));

  // Fold repeat copies of the same file into one entry.
  //
  // Upload dedupe is keyed on sha256, which is NULL on every row written
  // before the client started hashing — so it cannot see the six identical
  // copies of 2025_TaxReturn.pdf on deal b296dec2, all 1,013,618 bytes,
  // all sha256 NULL. Showing the borrower six of one document is what made
  // them upload the sixth. collapseDuplicateDocuments falls back to
  // filename+size when there is no hash to compare.
  //
  // Nothing is deleted: `copies` reports how many rows an entry stands for
  // and `duplicateIds` carries the rest, so a withdraw can still reach
  // them and the banker-facing views are unchanged.
  return NextResponse.json({
    ok: true,
    documents: collapseDuplicateDocuments(documents),
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
    .select("id, source, deal_id, original_filename, size_bytes, sha256")
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
    // Soft withdraw. `deal_documents` has no withdrawn_at column and adding
    // one is a schema change this launch does not need. `status` alone is
    // sufficient: the GET above filters on .neq("status", "withdrawn"), so
    // the row disappears from the borrower's view while remaining for audit.
    // `is_active` is deliberately NOT set — it has no migration on this table.
    .update({ status: "withdrawn", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("deal_id", context.dealId);

  if (error) {
    console.error("[borrower/documents] withdraw failed", error.message);
    return NextResponse.json(
      { ok: false, error: "Could not remove that document" },
      { status: 500 },
    );
  }

  // The GET above collapses identical copies into one entry, so the row the
  // borrower just removed may have been standing in for several. Withdrawing
  // only the visible one would make a duplicate reappear in its place — from
  // the borrower's side, a delete that did nothing. Withdraw the whole group.
  //
  // Scoped exactly as the visible delete is: same deal, borrower-uploaded
  // only, so this can never reach a document an advisor added.
  const target = doc as unknown as Pick<
    BorrowerDocumentRow,
    "original_filename" | "size_bytes" | "sha256"
  >;
  const siblings = sb
    .from("deal_documents")
    .select("id")
    .eq("deal_id", context.dealId)
    .neq("id", id)
    .neq("status", "withdrawn")
    .in("source", ["borrower", "borrower_portal"]);

  const { data: duplicateRows } = target.sha256
    ? await siblings.eq("sha256", target.sha256)
    : target.original_filename && target.size_bytes
      ? await siblings
          .is("sha256", null)
          .eq("original_filename", target.original_filename)
          .eq("size_bytes", target.size_bytes)
      : { data: [] };

  const duplicateIds = ((duplicateRows ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (duplicateIds.length > 0) {
    const { error: duplicateError } = await sb
      .from("deal_documents")
      .update({ status: "withdrawn", updated_at: new Date().toISOString() })
      .in("id", duplicateIds)
      .eq("deal_id", context.dealId);
    if (duplicateError) {
      // Non-fatal — the row they pointed at IS gone. Logged because a
      // surviving duplicate is what makes the delete look broken.
      console.error(
        "[borrower/documents] duplicate withdraw failed",
        duplicateError.message,
      );
    }
  }

  return NextResponse.json({ ok: true, alsoWithdrew: duplicateIds.length });
}

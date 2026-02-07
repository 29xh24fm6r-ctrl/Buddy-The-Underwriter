import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`timeout:${label}`)), ms)),
  ]);
}

export async function GET(
  _: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { userId } = await withTimeout(clerkAuth(), 8_000, "clerkAuth");
    if (!userId) {
      return NextResponse.json({ ok: false, files: [], error: "Unauthorized" }, { status: 401 });
    }

    const { dealId } = await ctx.params;
    const bankId = await withTimeout(getCurrentBankId(), 8_000, "getCurrentBankId");
    const sb = supabaseAdmin();

    // Tenant enforcement: ensure deal belongs to the active bank.
    const { data: deal, error: dealErr } = await withTimeout(
      sb.from("deals").select("id, bank_id").eq("id", dealId).maybeSingle(),
      8_000,
      "dealLookup",
    );
    if (dealErr || !deal || deal.bank_id !== bankId) {
      return NextResponse.json({ ok: false, files: [], error: "Deal not found" }, { status: 404 });
    }

    // Try RPC first
    const rpcRes: any = await withTimeout(
      sb.rpc("list_deal_documents", { p_deal_id: dealId }) as any,
      10_000,
      "list_deal_documents",
    );
    let { data, error } = rpcRes ?? {};

    // If RPC fails, log the actual error and fallback to direct SELECT
    if (error) {
      console.error("[/api/deals/[dealId]/files/list] RPC failed, attempting fallback", {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        dealId,
      });

      // Fallback: direct select from deal_documents including AI classification columns
      const fallbackRes = await withTimeout(
        sb.from("deal_documents")
          .select("id, deal_id, storage_bucket, storage_path, original_filename, display_name, document_type, doc_year, naming_method, mime_type, size_bytes, source, checklist_key, created_at, ai_doc_type, canonical_type, ai_confidence, ai_form_numbers, routing_class")
          .eq("deal_id", dealId)
          .order("created_at", { ascending: false }),
        10_000,
        "deal_documents_fallback",
      );

      if (fallbackRes.error) {
        console.error("[/api/deals/[dealId]/files/list] Fallback also failed", {
          error: fallbackRes.error.message,
          code: fallbackRes.error.code,
          dealId,
        });
        return NextResponse.json({
          ok: false,
          files: [],
          error: "Failed to load files",
          errorCode: fallbackRes.error.code,
        }, { status: 500 });
      }

      data = fallbackRes.data;
      error = null;
    }

    // Supplement: AI columns (RPC doesn't return them) + artifact processing status
    const docIds = (data ?? []).map((d: any) => d.id).filter(Boolean);
    const aiMap: Record<string, any> = {};
    const artifactMap: Record<string, { id: string; status: string; error_message: string | null }> = {};

    if (docIds.length > 0) {
      const [aiRes, artRes] = await Promise.all([
        // AI classification columns (supplement for RPC path; fallback already has them)
        withTimeout(
          sb.from("deal_documents")
            .select("id, ai_doc_type, canonical_type, ai_confidence, ai_form_numbers, routing_class")
            .in("id", docIds),
          8_000,
          "ai_columns",
        ),
        // Artifact processing status from document_artifacts
        withTimeout(
          sb.from("document_artifacts")
            .select("id, source_id, status, error_message")
            .eq("source_table", "deal_documents")
            .eq("deal_id", dealId)
            .in("source_id", docIds),
          8_000,
          "artifact_status",
        ),
      ]);

      if (aiRes.data) {
        for (const row of aiRes.data) aiMap[row.id] = row;
      }
      if (artRes.data) {
        for (const row of artRes.data) artifactMap[row.source_id] = row;
      }
    }

    // Back-compat: return the fields old UI expects from deal_files
    // Plus AI classification fields + artifact processing status
    const files = (data ?? []).map((d: any) => {
      const ai = aiMap[d.id];
      const art = artifactMap[d.id];
      return {
        file_id: d.id,
        stored_name: d.storage_path,
        original_name: d.original_filename,
        display_name: d.display_name ?? d.original_filename,
        document_type: d.document_type ?? null,
        doc_year: d.doc_year ?? null,
        naming_method: d.naming_method ?? null,
        mime_type: d.mime_type,
        created_at: d.created_at,
        deal_id: d.deal_id,
        storage_bucket: d.storage_bucket,
        storage_path: d.storage_path,
        size_bytes: d.size_bytes,
        source: d.source,
        checklist_key: d.checklist_key,
        // AI classification fields
        ai_doc_type: d.ai_doc_type ?? ai?.ai_doc_type ?? null,
        canonical_type: d.canonical_type ?? ai?.canonical_type ?? null,
        ai_confidence: d.ai_confidence ?? ai?.ai_confidence ?? null,
        ai_form_numbers: d.ai_form_numbers ?? ai?.ai_form_numbers ?? null,
        // Artifact processing status
        artifact_id: art?.id ?? null,
        artifact_status: art?.status ?? null,
        artifact_error: art?.error_message ?? null,
      };
    });

    return NextResponse.json({ ok: true, files });
  } catch (error: any) {
    const isTimeout = String(error?.message || "").startsWith("timeout:");
    console.error("[/api/deals/[dealId]/files/list]", error);
    return NextResponse.json({
      ok: false,
      files: [],
      error: isTimeout ? "Request timed out" : "Failed to load files",
    }, { status: isTimeout ? 504 : 500 });
  }
}

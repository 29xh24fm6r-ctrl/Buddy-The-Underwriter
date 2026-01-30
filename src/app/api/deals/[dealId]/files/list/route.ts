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

    const rpcRes: any = await withTimeout(
      sb.rpc("list_deal_documents", { p_deal_id: dealId }) as any,
      10_000,
      "list_deal_documents",
    );
    const { data, error } = rpcRes ?? {};

    if (error) {
      console.error("[/api/deals/[dealId]/files/list]", error.message, {
        details: error.details,
        hint: error.hint,
      });
      return NextResponse.json({
        ok: false,
        files: [],
        error: "Failed to load files",
      });
    }

    // Back-compat: return the fields old UI expects from deal_files
    // Plus new naming fields from two-phase naming
    const files = (data ?? []).map((d: any) => ({
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
    }));

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

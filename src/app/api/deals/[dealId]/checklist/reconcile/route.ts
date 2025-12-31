// src/app/api/deals/[dealId]/checklist/reconcile/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const dynamic = "force-dynamic";

/**
 * 🔥 CHECKLIST RECONCILIATION ENDPOINT
 * 
 * Backfills received_at for checklist items where matching docs exist.
 * Useful for:
 * - Documents uploaded BEFORE checklist seeded
 * - Checklist keys stamped after initial upload
 * - Manual reconciliation after auto-match runs
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await ctx.params;

    // Tenant enforcement
    const ensured = await ensureDealBankAccess(dealId);
    if (!ensured.ok) {
      const statusCode = 
        ensured.error === "deal_not_found" ? 404 :
        ensured.error === "tenant_mismatch" ? 403 :
        400;
      
      return NextResponse.json(
        { ok: false, error: ensured.error },
        { status: statusCode }
      );
    }

    const sb = supabaseAdmin();

    // 1️⃣ Pull all checklist_keys that exist in docs/files for this deal
    const [{ data: docs }, { data: files }] = await Promise.all([
      sb.from("deal_documents")
        .select("checklist_key")
        .eq("deal_id", dealId)
        .not("checklist_key", "is", null),
      sb.from("deal_files")
        .select("checklist_key")
        .eq("deal_id", dealId)
        .not("checklist_key", "is", null),
    ]);

    const keys = new Set<string>();
    (docs || []).forEach((r: any) => {
      if (r.checklist_key && String(r.checklist_key).trim()) {
        keys.add(String(r.checklist_key));
      }
    });
    (files || []).forEach((r: any) => {
      if (r.checklist_key && String(r.checklist_key).trim()) {
        keys.add(String(r.checklist_key));
      }
    });

    const keyList = Array.from(keys);
    if (!keyList.length) {
      return NextResponse.json({ 
        ok: true, 
        updated: 0, 
        keys: [],
        message: "No documents with checklist_key found",
      });
    }

    // 2️⃣ Mark matching checklist items received (idempotent)
    const { data: updated, error } = await sb
      .from("deal_checklist_items")
      .update({ 
        received_at: new Date().toISOString(), 
        status: "received",
        updated_at: new Date().toISOString(),
      })
      .eq("deal_id", dealId)
      .in("checklist_key", keyList)
      .is("received_at", null)
      .select("id, checklist_key");

    if (error) {
      console.error("[checklist/reconcile] update error:", error);
      throw error;
    }

    console.log("[checklist/reconcile] Reconciled", updated?.length || 0, "items for deal", dealId);

    return NextResponse.json({
      ok: true,
      updated: updated?.length || 0,
      keys: updated?.map((x: any) => x.checklist_key) || [],
      message: updated?.length 
        ? `Marked ${updated.length} items as received` 
        : "All items already up to date",
    });

  } catch (e: any) {
    console.error("[checklist/reconcile] error:", e);
    return NextResponse.json(
      { 
        ok: false, 
        error: e?.message || "Failed to reconcile checklist",
      },
      { status: 500 }
    );
  }
}

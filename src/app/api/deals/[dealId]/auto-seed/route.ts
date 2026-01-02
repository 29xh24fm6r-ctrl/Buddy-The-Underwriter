// src/app/api/deals/[dealId]/auto-seed/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { buildChecklistForLoanType } from "@/lib/deals/checklistPresets";
import { autoMatchChecklistFromFilename } from "@/lib/deals/autoMatchChecklistFromFilename";
import { reconcileChecklistForDeal } from "@/lib/checklist/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * 🔥 CANONICAL AUTO-SEED ENDPOINT
 * 
 * NEVER CRASHES. Handles all states:
 * - OCR not started
 * - OCR running
 * - OCR complete
 * - No uploads
 * 
 * Returns deterministic status, UI renders accordingly.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    console.log("[auto-seed] Processing request for dealId:", dealId);

    // 1️⃣ Get deal intake info (loan_type lives in deal_intake table, NOT deals table)
    const { data: intake, error: intakeErr } = await sb
      .from("deal_intake")
      .select("loan_type, sba_program")
      .eq("deal_id", dealId)
      .single();

    console.log("[auto-seed] Intake data:", { intake, intakeErr });

    if (intakeErr || !intake || !intake.loan_type) {
      console.warn("[auto-seed] No intake data found or missing loan_type");
      return NextResponse.json({
        ok: true,
        status: "pending",
        message: "Deal intake incomplete. Please set loan type first.",
        checklist: { seeded: 0, matched: 0, total: 0 },
      });
    }

    // 2️⃣ Check if OCR has run (optional, graceful degradation)
    const { data: pipelineEvents } = await sb
      .from("deal_pipeline_ledger")
      .select("stage, status, created_at")
      .eq("deal_id", dealId)
      .eq("stage", "ocr_complete")
      .order("created_at", { ascending: false })
      .limit(1);

    const hasOcrCompleted = pipelineEvents && pipelineEvents.length > 0 
      && pipelineEvents[0].status === "ok";

    // 3️⃣ Generate checklist items from loan type
    const checklistRows = buildChecklistForLoanType(intake.loan_type).map((r) => ({
      deal_id: dealId,
      checklist_key: r.checklist_key,
      title: r.title,
      description: r.description ?? null,
      required: r.required,
    }));

    console.log("[auto-seed] Generated checklist rows:", checklistRows.length);

    if (checklistRows.length === 0) {
      return NextResponse.json({
        ok: true,
        status: "ok",
        message: "No checklist items for this loan type.",
        checklist: { seeded: 0, matched: 0, total: 0 },
      });
    }

    // 4️⃣ Upsert checklist items (idempotent)
    const { error: seedErr } = await sb
      .from("deal_checklist_items")
      .upsert(checklistRows, { onConflict: "deal_id,checklist_key" });

    if (seedErr) {
      console.error("[auto-seed] checklist upsert failed:", seedErr);
      return NextResponse.json({
        ok: false,
        status: "error",
        error: "Failed to create checklist items",
        details: seedErr.message,
      });
    }

    console.log("[auto-seed] Checklist items upserted successfully");

    // Ensure seeded rows are in a deterministic initial state without clobbering received items.
    // (Older seeds may have inserted rows with status NULL.)
    try {
      const seededKeys = checklistRows.map((r) => r.checklist_key);
      await sb
        .from("deal_checklist_items")
        .update({ status: "missing" })
        .eq("deal_id", dealId)
        .in("checklist_key", seededKeys)
        .is("status", null);
    } catch (e) {
      console.warn("[auto-seed] status normalization failed (non-fatal):", e);
    }

    // 5️⃣ Auto-match uploaded files to checklist (doc_intel first; filename fallback)
    let matchedCount = 0;
    try {
      const { data: files } = await sb
        .rpc("list_deal_documents", { p_deal_id: dealId });

      console.log("[auto-seed] Found files for matching:", files?.length || 0);

      if (files && Array.isArray(files) && files.length > 0) {
        for (const file of files) {
          const result = await autoMatchChecklistFromFilename({
            dealId,
            filename: file.original_filename,
            fileId: file.id,
          });
          console.log("[auto-seed] Match result for", file.original_filename, ":", result);
          if (result.updated > 0) {
            matchedCount++;
          }

          // Best-effort: stamp the document row with the matched checklist key
          // (helps other views that rely on deal_documents.checklist_key)
          if (!file.checklist_key && result.matched.length > 0) {
            await sb
              .from("deal_documents")
              .update({ checklist_key: result.matched[0] })
              .eq("id", file.id);
          }
        }
      }
    } catch (matchErr) {
      console.warn("[auto-seed] auto-match error (non-fatal):", matchErr);
      // Continue anyway
    }

    // 🔥 6️⃣ RECONCILE: Mark checklist items as received if matching docs exist
    // This handles:
    // - Docs uploaded BEFORE checklist seeded
    // - Checklist keys stamped during auto-match above
    // - Any ordering/timing issues
    try {
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
      if (keyList.length > 0) {
        const { data: reconciled } = await sb
          .from("deal_checklist_items")
          .update({ 
            received_at: new Date().toISOString(), 
            status: "received",
            updated_at: new Date().toISOString(),
          })
          .eq("deal_id", dealId)
          .in("checklist_key", keyList)
          .is("received_at", null)
          .select("id");

        console.log("[auto-seed] Reconciled", reconciled?.length || 0, "items with existing docs");
      }
    } catch (reconcileErr) {
      console.warn("[auto-seed] reconcile non-fatal error:", reconcileErr);
    }

    // 7️⃣ Log to canonical ledger
    await sb.from("deal_pipeline_ledger").insert({
      deal_id: dealId,
      bank_id: bankId,
      stage: "auto_seeded",
      status: "ok",
      payload: {
        loan_type: intake.loan_type,
        checklist_count: checklistRows.length,
        files_matched: matchedCount,
        ocr_complete: hasOcrCompleted,
      },
    });

    console.log("[auto-seed] Success! Checklist:", {
      seeded: checklistRows.length,
      matched: matchedCount,
      total: checklistRows.length,
    });

    // ✅ Canonical Checklist Engine v2 reconciliation:
    // - year-aware satisfaction
    // - consistent status updates
    // - prevents UI staleness after save + auto-seed


    return NextResponse.json({
      ok: true,
      dealId,
      status: "ok",
      message: `Checklist created with ${checklistRows.length} items.${
        matchedCount > 0 ? ` Auto-matched ${matchedCount} files.` : ""
      }${
        !hasOcrCompleted ? " (Documents still processing in background.)" : ""
      }`,
      checklist: {
        seeded: checklistRows.length,
        matched: matchedCount,
        total: checklistRows.length,
      },
      pipeline_state: "checklist_seeded",
    });

  } catch (error: any) {
    console.error("[auto-seed] unexpected error:", error);
    
    // Even on error, return graceful response
    return NextResponse.json({
      ok: false,
      status: "error",
      error: "Auto-seed failed. Please try again or contact support.",
    }, { status: 500 });
  }
}

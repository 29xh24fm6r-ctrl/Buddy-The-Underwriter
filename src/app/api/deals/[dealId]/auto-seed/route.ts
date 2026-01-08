// src/app/api/deals/[dealId]/auto-seed/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { buildChecklistForLoanType } from "@/lib/deals/checklistPresets";
import { autoMatchChecklistFromFilename } from "@/lib/deals/autoMatchChecklistFromFilename";
import { recomputeDealReady } from "@/lib/deals/readiness";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { reconcileUploadsForDeal } from "@/lib/documents/reconcileUploads";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { reconcileDealChecklist } from "@/lib/checklist/engine";
import { getChecklistState } from "@/lib/checklist/getChecklistState";

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
 * New capabilities:
 * - Admin override: force=1 query param bypasses upload processing checks
 * - Partial mode: partial=1 query param seeds only matched documents
 * - Readiness-driven: uses persisted doc count vs expected
 * 
 * Returns deterministic status, UI renders accordingly.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    // Parse query params for readiness-driven logic
    const url = new URL(req.url);
    const expectedRaw = url.searchParams.get("expected");
    const expected = expectedRaw ? Math.max(0, parseInt(expectedRaw, 10) || 0) : null;
    const partial = url.searchParams.get("partial") === "1";
    const force = url.searchParams.get("force") === "1";
    // IMPORTANT: When match=0, auto-seed should NOT touch deal_documents rows.
    // This prevents downstream systems from treating auto-seed as a doc-processing trigger.
    const match = url.searchParams.get("match") !== "0";

    console.log("[auto-seed] Processing request for dealId:", dealId, { expected, partial, force, match });

    // Admin gate (Clerk): only admins can force
    const { userId } = await clerkAuth();
    const adminIds = (process.env.ADMIN_CLERK_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const isAdmin = userId ? adminIds.includes(userId) : false;

    // Persisted docs = source of truth
    const { count, error: countErr } = await sb
      .from("deal_documents")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("bank_id", bankId);

    if (countErr) throw countErr;

    const persisted = count ?? 0;
    const exp = expected ?? persisted;
    const remaining = Math.max(0, exp - persisted);
    const ready = remaining === 0;

    // Blocking rules
    if (!ready && !partial) {
      if (force && !isAdmin) {
        Sentry.captureMessage("auto-seed forbidden (force without admin)", {
          level: "warning",
          tags: { route: "auto-seed" },
          extra: { dealId, bankId, expected, partial, force, match, remaining },
        });
        return NextResponse.json(
          { ok: false, error: "Forbidden", status: "forbidden" },
          { status: 403 }
        );
      }
      if (!force) {
        Sentry.captureMessage("auto-seed blocked (uploads still processing)", {
          level: "info",
          tags: { route: "auto-seed" },
          extra: { dealId, bankId, expected, partial, force, match, remaining },
        });
        return NextResponse.json(
          { ok: false, error: "Uploads still processing", remaining, status: "blocked" },
          { status: 409 }
        );
      }
      // force + admin => allowed
    }

    // Admin override audit log
    if (force && isAdmin) {
      await sb.from("deal_pipeline_ledger").insert({
        deal_id: dealId,
        bank_id: bankId,
        stage: "auto_seed",
        status: "admin_override",
        payload: { 
          adminOverride: true,
          uploadsRemaining: remaining
        },
      } as any);
    }

    // Partial mode audit log
    if (partial) {
      await sb.from("deal_pipeline_ledger").insert({
        deal_id: dealId,
        bank_id: bankId,
        stage: "auto_seed",
        status: "partial_mode",
        payload: { mode: "partial" },
      } as any);
    }

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

    // 🔥 LEDGER: Log auto-seed start
    await sb.from("deal_pipeline_ledger").insert({
      deal_id: dealId,
      bank_id: bankId,
      stage: "auto_seed",
      status: "started",
      payload: { 
        loan_type: intake.loan_type,
        partial,
        force,
        match,
      },
    } as any);

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
    const checklistRowsWithBank = buildChecklistForLoanType(intake.loan_type).map((r) => ({
      deal_id: dealId,
      bank_id: bankId, // CRITICAL: Multi-tenant isolation (if column exists)
      checklist_key: r.checklist_key,
      title: r.title,
      description: r.description ?? null,
      required: r.required,
    }));

        // Fallback for environments that don't yet have bank_id on deal_checklist_items
        const checklistRowsNoBank = checklistRowsWithBank.map(({ bank_id: _bankId, ...rest }) => rest);

    console.log("[auto-seed] Generated checklist rows:", checklistRowsWithBank.length, "bank_id:", bankId);

    if (checklistRowsWithBank.length === 0) {
      return NextResponse.json({
        ok: true,
        status: "ok",
        message: "No checklist items for this loan type.",
        checklist: { seeded: 0, matched: 0, total: 0 },
      });
    }

    // 4️⃣ Upsert checklist items (idempotent)
    let upsertedRows: any[] | null = null;
    let seedErr: any = null;

    // Try with bank_id first (canonical). If schema doesn't have bank_id, retry without.
    {
      const attempt1 = await sb
        .from("deal_checklist_items")
        .upsert(checklistRowsWithBank as any, { onConflict: "deal_id,checklist_key" })
        .select("id");

      upsertedRows = attempt1.data as any;
      seedErr = attempt1.error as any;

      const msg = String(seedErr?.message ?? "");
      if (seedErr && msg.includes("bank_id") && msg.includes("does not exist")) {
        const attempt2 = await sb
          .from("deal_checklist_items")
          .upsert(checklistRowsNoBank as any, { onConflict: "deal_id,checklist_key" })
          .select("id");
        upsertedRows = attempt2.data as any;
        seedErr = attempt2.error as any;
      }
    }

    console.log("[auto-seed] Upsert result:", { 
      error: seedErr, 
      rowsReturned: upsertedRows?.length 
    });

    if (seedErr) {
      console.error("[auto-seed] checklist upsert failed:", seedErr);
      Sentry.captureException(seedErr, {
        tags: { route: "auto-seed", phase: "checklist_upsert" },
        extra: {
          dealId,
          bankId,
          expected,
          partial,
          force,
          match,
          supabase: {
            message: seedErr?.message,
            code: seedErr?.code,
            details: seedErr?.details,
          },
        },
      });
      
      // Log error to pipeline
      await sb.from("deal_pipeline_ledger").insert({
        deal_id: dealId,
        bank_id: bankId,
        stage: "auto_seed",
        status: "error",
        payload: { 
          error: seedErr.message,
          code: seedErr.code,
          details: seedErr.details
        },
      } as any);
      
      return NextResponse.json({
        ok: false,
        status: "error",
        error: "Failed to create checklist items",
        details: seedErr.message,
      });
    }

    console.log("[auto-seed] Checklist items upserted successfully, rows:", upsertedRows?.length);

    // Ensure seeded rows are in a deterministic initial state without clobbering received items.
    // (Older seeds may have inserted rows with status NULL.)
    try {
      const seededKeys = checklistRowsWithBank.map((r) => r.checklist_key);
      await sb
        .from("deal_checklist_items")
        .update({ status: "missing" })
        .eq("deal_id", dealId)
        .in("checklist_key", seededKeys)
        .is("status", null);
    } catch (e) {
      console.warn("[auto-seed] status normalization failed (non-fatal):", e);
    }

    // 5️⃣ RECONCILE UPLOADS → deal_documents (canonical)
    // borrower_uploads are raw/immutable; deal_documents is canonical.
    const reconcileRes = await reconcileUploadsForDeal(dealId, bankId);
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "reconcile_uploads",
      uiState: "done",
      uiMessage: `Matched ${reconcileRes.matched} documents`,
      meta: { matched: reconcileRes.matched },
    });

    // 5b) Canonical checklist engine reconciliation (stamps deal_documents + updates checklist)
    // This is required for banker uploads that happened BEFORE intake/checklist seeding.
    if (match) {
      try {
        const r = await reconcileDealChecklist(dealId);
        console.log("[auto-seed] reconcileDealChecklist", r);
      } catch (e) {
        console.warn("[auto-seed] reconcileDealChecklist failed (non-fatal):", e);
      }
    }

    // 6️⃣ Auto-match uploaded files to checklist (doc_intel first; filename fallback)
    // IMPORTANT: This only updates deal_checklist_items (marks items received) and does NOT
    // mutate deal_documents rows. It is safe to run even when match=0.
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
        }
      }
    } catch (matchErr) {
      console.warn("[auto-seed] auto-match error (non-fatal):", matchErr);
      // Continue anyway
    }

    // 🔥 7️⃣ RECONCILE: Mark checklist items as received if matching docs exist
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

    // 8️⃣ Log to canonical ledger
    await sb.from("deal_pipeline_ledger").insert({
      deal_id: dealId,
      bank_id: bankId,
      stage: "auto_seed",
      status: "completed",
      payload: {
        loan_type: intake.loan_type,
        checklist_count: checklistRowsWithBank.length,
        files_matched: matchedCount,
        ocr_complete: hasOcrCompleted,
        partial,
        force,
        match,
      },
    });

    console.log("[auto-seed] Success! Checklist:", {
      seeded: checklistRowsWithBank.length,
      matched: matchedCount,
      total: checklistRowsWithBank.length,
    });

    // ✅ Canonical Checklist Engine v2 reconciliation is intentionally skipped when match=0
    // because it may update deal_documents rows (stamping checklist_key/doc_year), which can
    // kick off downstream document processing.

    // 🧠 CONVERGENCE: Recompute deal readiness after auto-seed
    await recomputeDealReady(dealId);

    // Snapshot checklist counts after reconciliation so UI can display totals.
    // This avoids confusing UX where `matchedCount` can be 0 when items were already received.
    const postChecklist = await getChecklistState({ dealId, includeItems: false });


    return NextResponse.json({
      ok: true,
      dealId,
      status: "ok",
      message: `Checklist created with ${checklistRowsWithBank.length} items.${
        matchedCount > 0 ? ` Auto-matched ${matchedCount} files.` : ""
      }${
        !hasOcrCompleted ? " (Documents still processing in background.)" : ""
      }`,
      checklist: {
        seeded: checklistRowsWithBank.length,
        matched: matchedCount,
        total: checklistRowsWithBank.length,
        ...(postChecklist.ok
          ? {
              state: postChecklist.state,
              received_total: postChecklist.received,
              pending_total: postChecklist.pending,
              optional_total: postChecklist.optional,
            }
          : {}),
      },
      pipeline_state: "checklist_seeded",
    });

  } catch (error: any) {
    console.error("[auto-seed] unexpected error:", error);

    Sentry.captureException(error, {
      tags: { route: "auto-seed", phase: "unexpected" },
    });
    
    // Even on error, return graceful response
    return NextResponse.json({
      ok: false,
      status: "error",
      error: "Auto-seed failed. Please try again or contact support.",
    }, { status: 500 });
  }
}

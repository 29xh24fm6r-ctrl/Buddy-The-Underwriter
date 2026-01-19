import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { runPolicyAwareUnderwriting } from "@/lib/underwrite/policyEngine";
import { upsertDealStatusAndLog } from "@/lib/deals/status";
import { advanceDealLifecycle } from "@/lib/deals/advanceDealLifecycle";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { emitBuddySignalServer } from "@/buddy/emitBuddySignalServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ dealId: string }>;
};

/**
 * POST /api/deals/[dealId]/underwrite/start
 * 
 * Starts the underwriting pipeline:
 * 1. Validates all required checklist items received
 * 2. Runs extraction confidence review
 * 3. Triggers risk scoring
 * 4. Queues memo generation
 * 5. Notifies underwriter
 */
export async function POST(req: NextRequest, ctx: Context) {
  try {
    const { userId } = await clerkAuth();
    if (!userId)
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );

    const { dealId } = await ctx.params;
    const sb = supabaseAdmin();

    const bankId = await getCurrentBankId().catch((e: any) => {
      const msg = String(e?.message ?? e ?? "");
      // getCurrentBankId throws "not_authenticated" for signed-out users
      if (msg === "not_authenticated") return null;
      // Preserve a safe error surface
      throw new Error(msg || "bank_not_resolved");
    });

    if (!bankId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // 1. Check if deal exists
    const { data: deal, error: dealError } = await sb
      .from("deals")
      .select("id, name, borrower_name, bank_id, lifecycle_stage")
      .eq("id", dealId)
      .single();

    if (dealError || !deal) {
      return NextResponse.json(
        { ok: false, error: "Deal not found" },
        { status: 404 }
      );
    }

    // Tenant enforcement (and first-touch binding if deal.bank_id is null)
    if (deal.bank_id && String(deal.bank_id) !== String(bankId)) {
      // Do not leak existence across tenants
      return NextResponse.json({ ok: false, error: "Deal not found" }, { status: 404 });
    }

    if (!deal.bank_id) {
      const { error: bankAssignErr } = await sb
        .from("deals")
        .update({ bank_id: bankId })
        .eq("id", dealId);

      if (bankAssignErr) {
        return NextResponse.json(
          { ok: false, error: "Failed to bind deal to bank" },
          { status: 500 },
        );
      }
      (deal as any).bank_id = bankId;
    }

    if (deal.lifecycle_stage !== "collecting" && deal.lifecycle_stage !== "ready") {
      return NextResponse.json(
        { ok: false, error: "Deal not ready for underwriting" },
        { status: 400 }
      );
    }

    // 2. Verify all required checklist items are received
    const { data: checklist } = await sb
      .from("deal_checklist_items")
      .select("id, checklist_key, required, received_at")
      .eq("deal_id", dealId);

    const requiredItems = checklist?.filter((i) => i.required) || [];
    const receivedRequired = requiredItems.filter((i) => i.received_at);
    const { count: docCount } = await sb
      .from("deal_documents")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);

    if (requiredItems.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No required checklist items defined" },
        { status: 400 }
      );
    }

    if (receivedRequired.length < requiredItems.length) {
      const missing = requiredItems
        .filter((i) => !i.received_at)
        .map((i) => i.checklist_key);

      return NextResponse.json(
        {
          ok: false,
          error: "Not all required items received",
          missing,
          progress: {
            required: requiredItems.length,
            received: receivedRequired.length,
          },
        },
        { status: 400 }
      );
    }

    // 3. Check extraction confidence (get all uploaded docs with extractions)
    const { data: uploads } = await sb
      .from("deal_uploads")
      .select(`
        upload_id,
        uploads (
          filename,
          doc_extractions (
            id,
            status,
            confidence_score,
            doc_fields (
              id,
              field_key,
              confidence,
              needs_attention
            )
          )
        )
      `)
      .eq("deal_id", dealId);

    const lowConfidenceFields: any[] = [];
    let totalFields = 0;
    let highConfidenceFields = 0;

    uploads?.forEach((upload: any) => {
      upload.uploads?.doc_extractions?.forEach((extraction: any) => {
        extraction.doc_fields?.forEach((field: any) => {
          totalFields++;
          if (field.confidence && field.confidence >= 0.85) {
            highConfidenceFields++;
          } else if (field.needs_attention || (field.confidence && field.confidence < 0.7)) {
            lowConfidenceFields.push({
              upload_id: upload.upload_id,
              filename: upload.uploads.filename,
              field_key: field.field_key,
              confidence: field.confidence,
            });
          }
        });
      });
    });

    const confidenceScore = totalFields > 0 
      ? Math.round((highConfidenceFields / totalFields) * 100) 
      : 0;

    // 4. Advance lifecycle to underwriting (explicit)
    const lifecycle = await advanceDealLifecycle({
      dealId,
      toStage: "underwriting",
      reason: "underwriting_started",
      source: "underwrite_start",
      actor: { userId, type: "user" },
    });

    if (!lifecycle.ok) {
      return NextResponse.json(
        { ok: false, error: "Failed to start underwriting" },
        { status: 400 },
      );
    }

    // 5. Run policy-aware underwriting (deterministic engine + truth snapshot logging)
    let policy: Awaited<ReturnType<typeof runPolicyAwareUnderwriting>> | null = null;
    try {
      policy = await runPolicyAwareUnderwriting({ dealId, bankId });
    } catch (e: any) {
      console.error("[/api/deals/[dealId]/underwrite/start] policy engine failed", {
        dealId,
        bankId,
        error: e?.message ?? String(e),
      });
      return NextResponse.json(
        { ok: false, error: "Policy engine failed" },
        { status: 500 },
      );
    }

    // 6. Emit underwriting_started event
    await writeEvent({
      dealId,
      kind: "deal.underwriting.started",
      actorUserId: userId,
      input: {
        checklist_complete: true,
        required_items: requiredItems.length,
        checklist_snapshot: requiredItems.map((i) => i.checklist_key),
        document_count: docCount ?? null,
      },
      meta: {
        confidence_score: confidenceScore,
        low_confidence_fields: lowConfidenceFields.length,
        policy_compliance_score: policy?.complianceScore ?? null,
        policy_exceptions: policy?.exceptions?.length ?? 0,
        triggered_by: "manual",
      },
    });

    await logLedgerEvent({
      dealId,
      bankId: deal.bank_id,
      eventKey: "deal.underwriting.started",
      uiState: "done",
      uiMessage: "Underwriting started",
      meta: {
        required_items: requiredItems.length,
        received_items: receivedRequired.length,
        confidence_score: confidenceScore,
      },
    });

    emitBuddySignalServer({
      type: "deal.underwriting.started",
      source: "api/deals/[dealId]/underwrite/start",
      ts: Date.now(),
      dealId,
      payload: {
        required_items: requiredItems.length,
        received_items: receivedRequired.length,
      },
    });

    // 7. Update deal timeline stage (best-effort)
    try {
      await upsertDealStatusAndLog({
        dealId,
        stage: "underwriting",
        actorUserId: userId,
      });
    } catch (e: any) {
      console.warn("[/api/deals/[dealId]/underwrite/start] deal_status update failed (non-fatal)", {
        dealId,
        error: e?.message ?? String(e),
      });
    }

    // 7. Queue underwriter notification
    const { data: bankUsers } = await sb
      .from("bank_memberships")
      .select("user_id, users (email)")
      .eq("bank_id", deal.bank_id);

    const underwriterEmails = bankUsers
      ?.map((m: any) => m.users?.email)
      .filter(Boolean) || [];

    if (underwriterEmails.length > 0) {
      await sb.from("notification_queue").insert(
        underwriterEmails.map((email: string) => ({
          deal_id: dealId,
          notification_type: "email",
          recipient: email,
          subject: `Deal Ready for Underwriting: ${deal.name || deal.borrower_name || "Untitled"}`,
          body: `All required documents have been received and confirmed by the borrower. The deal is ready for underwriting review.`,
          template_key: "deal_ready_for_underwriting",
          metadata: {
            deal_id: dealId,
            deal_name: deal.name,
            confidence_score: confidenceScore,
            low_confidence_count: lowConfidenceFields.length,
          },
        }))
      );
    }

    return NextResponse.json({
      ok: true,
      pipeline_started: true,
      confidence_review: {
        total_fields: totalFields,
        high_confidence: highConfidenceFields,
        confidence_score: confidenceScore,
        low_confidence_fields: lowConfidenceFields,
      },
      policy,
      checklist: {
        required: requiredItems.length,
        received: receivedRequired.length,
      },
      notifications_queued: underwriterEmails.length,
    });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/underwrite/start]", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to start underwriting",
      },
      { status: 500 },
    );
  }
}

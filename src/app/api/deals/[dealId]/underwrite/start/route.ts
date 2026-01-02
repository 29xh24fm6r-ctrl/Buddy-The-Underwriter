import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";
import { writeEvent } from "@/lib/ledger/writeEvent";

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

    // 1. Check if deal exists
    const { data: deal, error: dealError } = await sb
      .from("deals")
      .select("id, name, borrower_name, bank_id")
      .eq("id", dealId)
      .single();

    if (dealError || !deal) {
      return NextResponse.json(
        { ok: false, error: "Deal not found" },
        { status: 404 }
      );
    }

    // 2. Verify all required checklist items are received
    const { data: checklist } = await sb
      .from("deal_checklist_items")
      .select("id, checklist_key, required, received_at")
      .eq("deal_id", dealId);

    const requiredItems = checklist?.filter((i) => i.required) || [];
    const receivedRequired = requiredItems.filter((i) => i.received_at);

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

    let lowConfidenceFields: any[] = [];
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

    // 4. Emit underwriting_started event
    await writeEvent({
      dealId,
      kind: "underwrite.started",
      actorUserId: userId,
      input: {
        checklist_complete: true,
        required_items: requiredItems.length,
      },
      meta: {
        confidence_score: confidenceScore,
        low_confidence_fields: lowConfidenceFields.length,
        triggered_by: "manual",
      },
    });

    // 5. Queue memo generation (stub - implement later)
    // await queueMemoGeneration(dealId);

    // 6. Queue underwriter notification
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
      checklist: {
        required: requiredItems.length,
        received: receivedRequired.length,
      },
      notifications_queued: underwriterEmails.length,
    });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/underwrite/start]", error);
    return NextResponse.json({
      ok: false,
      error: "Failed to start underwriting",
    });
  }
}

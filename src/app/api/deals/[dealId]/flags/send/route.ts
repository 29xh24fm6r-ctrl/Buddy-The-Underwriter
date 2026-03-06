import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { buildSendPackage } from "@/lib/flagEngine/sendPackageBuilder";
import type { SpreadFlag, BorrowerQuestion } from "@/lib/flagEngine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

// ---------------------------------------------------------------------------
// POST — build send package, persist, update flag statuses
// ---------------------------------------------------------------------------

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();

    // Get deal name
    const { data: deal } = await (sb as any)
      .from("deals")
      .select("name, borrower_name")
      .eq("id", dealId)
      .maybeSingle();

    const dealName = deal?.name || deal?.borrower_name || "this loan";

    // Query banker_reviewed flags with questions
    const { data: flagRows, error: flagError } = await (sb as any)
      .from("deal_flags")
      .select("*")
      .eq("deal_id", dealId)
      .eq("status", "banker_reviewed")
      .eq("has_borrower_question", true);

    if (flagError) {
      return NextResponse.json(
        { ok: false, error: "flags_fetch_failed" },
        { status: 500 },
      );
    }

    const flags = (flagRows ?? []) as Array<Record<string, any>>;
    if (flags.length === 0) {
      return NextResponse.json(
        { ok: false, error: "no_reviewed_flags_with_questions" },
        { status: 422 },
      );
    }

    // Fetch corresponding questions
    const flagIds = flags.map((f) => f.id);
    const { data: questionRows } = await (sb as any)
      .from("deal_borrower_questions")
      .select("*")
      .in("flag_id", flagIds);

    const questionsByFlagId = new Map<string, Record<string, any>>();
    for (const q of (questionRows ?? []) as Array<Record<string, any>>) {
      questionsByFlagId.set(q.flag_id, q);
    }

    // Map DB rows to SpreadFlag[] for the pure buildSendPackage function
    const spreadFlags: SpreadFlag[] = flags
      .filter((f) => questionsByFlagId.has(f.id))
      .map((f) => {
        const q = questionsByFlagId.get(f.id)!;
        const borrowerQuestion: BorrowerQuestion = {
          question_id: q.id,
          flag_id: f.id,
          question_text: q.question_text,
          question_context: q.question_context,
          document_requested: q.document_requested ?? undefined,
          document_format: q.document_format ?? undefined,
          document_urgency: q.document_urgency ?? "preferred",
          recipient_type: q.recipient_type ?? "borrower",
        };

        return {
          flag_id: f.id,
          deal_id: dealId,
          category: f.category,
          severity: f.severity,
          trigger_type: f.trigger_type,
          canonical_keys_involved: f.canonical_keys_involved ?? [],
          observed_value: f.observed_value,
          year_observed: f.year_observed,
          banker_summary: f.banker_summary,
          banker_detail: f.banker_detail,
          banker_implication: f.banker_implication,
          borrower_question: borrowerQuestion,
          status: "banker_reviewed" as const,
          auto_generated: f.auto_generated ?? true,
          created_at: f.created_at,
          updated_at: f.updated_at,
        };
      });

    if (spreadFlags.length === 0) {
      return NextResponse.json(
        { ok: false, error: "no_flags_with_questions" },
        { status: 422 },
      );
    }

    // Build send package (pure function)
    const pkg = buildSendPackage(spreadFlags, dealName);

    // Persist send package
    await (sb as any).from("deal_flag_send_packages").insert({
      deal_id: dealId,
      sent_by: access.userId,
      cover_message: pkg.cover_message,
      question_count: pkg.questions.length,
      document_request_count: pkg.document_requests.length,
      package_json: pkg,
    });

    const now = new Date().toISOString();

    // Update all included flags to sent_to_borrower
    const includedFlagIds = spreadFlags.map((f) => f.flag_id);
    await (sb as any)
      .from("deal_flags")
      .update({ status: "sent_to_borrower", updated_at: now })
      .in("id", includedFlagIds);

    // Update questions with sent_at
    await (sb as any)
      .from("deal_borrower_questions")
      .update({ sent_at: now, updated_at: now })
      .in("flag_id", includedFlagIds);

    // Write audit entries
    for (const flagId of includedFlagIds) {
      await (sb as any).from("deal_flag_audit").insert({
        deal_id: dealId,
        flag_id: flagId,
        action: "question_sent",
        actor: access.userId,
        previous_status: "banker_reviewed",
        new_status: "sent_to_borrower",
        note: `Sent as part of question package (${pkg.questions.length} questions, ${pkg.document_requests.length} doc requests)`,
      });
    }

    // Ledger event
    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "flags.questions_sent",
      uiState: "done",
      uiMessage: `${pkg.questions.length} questions and ${pkg.document_requests.length} document requests sent to borrower`,
      meta: {
        questionCount: pkg.questions.length,
        documentRequestCount: pkg.document_requests.length,
        sentBy: access.userId,
      },
    });

    return NextResponse.json({ ok: true, package: pkg });
  } catch (e: any) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }
    console.error("[/api/deals/[dealId]/flags/send POST]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

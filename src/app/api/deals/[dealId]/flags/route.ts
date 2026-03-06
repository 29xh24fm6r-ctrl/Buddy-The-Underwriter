import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

// ---------------------------------------------------------------------------
// Types for DB rows
// ---------------------------------------------------------------------------

type DbFlag = {
  id: string;
  deal_id: string;
  category: string;
  severity: string;
  trigger_type: string;
  canonical_keys_involved: string[];
  observed_value: string | null;
  expected_range_min: number | null;
  expected_range_max: number | null;
  expected_range_description: string | null;
  year_observed: number | null;
  banker_summary: string;
  banker_detail: string;
  banker_implication: string;
  has_borrower_question: boolean;
  status: string;
  banker_note: string | null;
  borrower_response: string | null;
  resolution_note: string | null;
  waived_by: string | null;
  waived_reason: string | null;
  auto_generated: boolean;
  created_at: string;
  updated_at: string;
};

type DbQuestion = {
  id: string;
  deal_id: string;
  flag_id: string;
  question_text: string;
  question_context: string;
  document_requested: string | null;
  document_format: string | null;
  document_urgency: string;
  recipient_type: string;
  send_method: string | null;
  sent_at: string | null;
  answered_at: string | null;
  answer_text: string | null;
};

// ---------------------------------------------------------------------------
// GET — fetch all flags + questions for a deal
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();

    // Fetch flags ordered by severity then created_at
    const { data: flagRows, error: flagError } = await (sb as any)
      .from("deal_flags")
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: true });

    if (flagError) {
      return NextResponse.json(
        { ok: false, error: "flags_fetch_failed" },
        { status: 500 },
      );
    }

    const flags = (flagRows ?? []) as DbFlag[];

    // Sort by severity order then category
    const SEVERITY_ORDER: Record<string, number> = {
      critical: 1,
      elevated: 2,
      watch: 3,
      informational: 4,
    };
    flags.sort((a, b) => {
      const sevDiff = (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5);
      if (sevDiff !== 0) return sevDiff;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    // Fetch all questions for this deal
    const { data: questionRows } = await (sb as any)
      .from("deal_borrower_questions")
      .select("*")
      .eq("deal_id", dealId);

    const questions = (questionRows ?? []) as DbQuestion[];
    const questionsByFlagId = new Map<string, DbQuestion>();
    for (const q of questions) {
      questionsByFlagId.set(q.flag_id, q);
    }

    // Attach questions to flags
    const flagsWithQuestions = flags.map((f) => ({
      ...f,
      question: questionsByFlagId.get(f.id) ?? null,
    }));

    // Summary counts
    let critical = 0;
    let elevated = 0;
    let watch = 0;
    let informational = 0;
    for (const f of flags) {
      switch (f.severity) {
        case "critical": critical++; break;
        case "elevated": elevated++; break;
        case "watch": watch++; break;
        case "informational": informational++; break;
      }
    }

    return NextResponse.json({
      ok: true,
      flags: flagsWithQuestions,
      summary: {
        critical,
        elevated,
        watch,
        informational,
        has_blocking: critical > 0,
        total: flags.length,
      },
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }
    console.error("[/api/deals/[dealId]/flags GET]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — update flag status (review, waive, resolve, reopen)
// ---------------------------------------------------------------------------

const STATUS_TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  review: { from: ["open"], to: "banker_reviewed" },
  waive: { from: ["banker_reviewed"], to: "waived" },
  resolve: { from: ["open", "banker_reviewed", "sent_to_borrower", "answered"], to: "resolved" },
  reopen: { from: ["waived", "resolved"], to: "open" },
};

export async function PATCH(req: NextRequest, ctx: Ctx) {
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

    const body = await req.json();
    const { flag_id, action, note, waived_reason } = body as {
      flag_id: string;
      action: string;
      note?: string;
      waived_reason?: string;
    };

    if (!flag_id || !action) {
      return NextResponse.json(
        { ok: false, error: "flag_id and action are required" },
        { status: 422 },
      );
    }

    const transition = STATUS_TRANSITIONS[action];
    if (!transition) {
      return NextResponse.json(
        { ok: false, error: `Invalid action: ${action}` },
        { status: 422 },
      );
    }

    if (action === "waive" && !waived_reason) {
      return NextResponse.json(
        { ok: false, error: "waived_reason is required when waiving a flag" },
        { status: 422 },
      );
    }

    const sb = supabaseAdmin();

    // Fetch current flag
    const { data: currentFlag, error: fetchError } = await (sb as any)
      .from("deal_flags")
      .select("*")
      .eq("id", flag_id)
      .eq("deal_id", dealId)
      .maybeSingle();

    if (fetchError || !currentFlag) {
      return NextResponse.json(
        { ok: false, error: "flag_not_found" },
        { status: 404 },
      );
    }

    const previousStatus = currentFlag.status;
    if (!transition.from.includes(previousStatus)) {
      return NextResponse.json(
        { ok: false, error: `Cannot ${action} a flag with status '${previousStatus}'` },
        { status: 422 },
      );
    }

    // Build update payload
    const updatePayload: Record<string, unknown> = {
      status: transition.to,
      updated_at: new Date().toISOString(),
    };

    if (note) updatePayload.banker_note = note;
    if (action === "waive") {
      updatePayload.waived_by = access.userId;
      updatePayload.waived_reason = waived_reason;
    }
    if (action === "resolve" && note) {
      updatePayload.resolution_note = note;
    }

    // Update flag
    const { data: updatedFlag, error: updateError } = await (sb as any)
      .from("deal_flags")
      .update(updatePayload)
      .eq("id", flag_id)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: "update_failed" },
        { status: 500 },
      );
    }

    // Write audit entry
    await (sb as any).from("deal_flag_audit").insert({
      deal_id: dealId,
      flag_id,
      action,
      actor: access.userId,
      previous_status: previousStatus,
      new_status: transition.to,
      note: note ?? null,
    });

    return NextResponse.json({ ok: true, flag: updatedFlag });
  } catch (e: any) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }
    console.error("[/api/deals/[dealId]/flags PATCH]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

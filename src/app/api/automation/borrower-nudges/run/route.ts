import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  computeStall,
  shouldThrottle,
} from "@/lib/borrowerAutomation/stallRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/automation/borrower-nudges/run
 *
 * Automation runner: generates draft nudge messages for stalled conditions
 *
 * Flow:
 * 1. Load outstanding conditions for deal
 * 2. Detect borrower activity timestamp
 * 3. Apply stall rules
 * 4. Check throttles
 * 5. Draft PORTAL messages (DRAFT status)
 * 6. Underwriter must approve before send
 *
 * Body: { deal_id: string }
 * Returns: { ok: true, deal_id: string, drafted: number }
 */
export async function POST(req: NextRequest) {
  requireSuperAdmin(); // Phase 1: admin-only. Later: auto-trigger on schedule
  const supabase = supabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const dealId = body?.deal_id as string | undefined;

  if (!dealId) {
    return NextResponse.json(
      { ok: false, error: "deal_id required for phase 1" },
      { status: 400 },
    );
  }

  const now = new Date();

  // 1) Load outstanding conditions
  const { data: conditions, error: e1 } = await supabase
    .from("conditions_to_close")
    .select(
      "id, application_id, title, status, severity, ai_explanation, last_evaluated_at",
    )
    .eq("application_id", dealId)
    .neq("status", "satisfied");

  if (e1) {
    return NextResponse.json({ ok: false, error: e1.message }, { status: 500 });
  }

  const outstanding = conditions ?? [];

  // 2) Find last borrower activity (latest attachment upload)
  const { data: att, error: e2 } = await supabase
    .from("borrower_attachments")
    .select("created_at")
    .eq("application_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (e2) {
    return NextResponse.json({ ok: false, error: e2.message }, { status: 500 });
  }

  const lastBorrowerActivityAt = (att as any)?.created_at ?? null;

  let drafted = 0;
  const messages: any[] = [];

  for (const c of outstanding) {
    // 3) Apply stall rules
    const stall = computeStall({
      lastBorrowerActivityAt,
      lastEvaluatedAt: (c as any).last_evaluated_at ?? null,
      now,
    });

    if (!stall.stalled) continue;

    // 4) Check throttles
    const { data: throttle } = await supabase
      .from("condition_message_throttles")
      .select("send_count, last_sent_at")
      .eq("application_id", dealId)
      .eq("condition_id", (c as any).id)
      .maybeSingle();

    if (
      throttle &&
      shouldThrottle({
        sendCount: (throttle as any).send_count ?? 0,
        lastSentAt: (throttle as any).last_sent_at ?? null,
        now,
      })
    ) {
      continue; // Throttled
    }

    // 5) Draft message
    const bodyText = (c as any).ai_explanation
      ? `Reminder: ${(c as any).ai_explanation}\n\nNext step: Please upload the requested document(s).`
      : `Reminder: A condition is still outstanding. Please upload the requested document(s).`;

    const msg = {
      application_id: dealId,
      condition_id: (c as any).id,
      channel: "PORTAL",
      direction: "OUTBOUND",
      status: "DRAFT",
      subject: `Action needed: ${(c as any).title}`,
      body: bodyText,
      priority: (c as any).severity === "REQUIRED" ? "HIGH" : "MEDIUM",
      trigger_type: "AUTO_STALL",
      ai_generated: true,
      requires_approval: true,
      metadata: { stall_reason: stall.reason },
    };

    messages.push(msg);
  }

  // 6) Insert draft messages
  if (messages.length) {
    const { error: e3 } = await supabase
      .from("condition_messages")
      .insert(messages as any);
    if (e3) {
      return NextResponse.json(
        { ok: false, error: e3.message },
        { status: 500 },
      );
    }
    drafted = messages.length;
  }

  return NextResponse.json({ ok: true, deal_id: dealId, drafted });
}

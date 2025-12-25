import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { evaluateTriggers } from "@/lib/conditions/messaging/triggers";
import { checkThrottle } from "@/lib/conditions/messaging/throttle";
import { aiDraftMessage } from "@/lib/conditions/messaging/aiDraft";
import { queueMessage, skipMessage } from "@/lib/conditions/messaging/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _: Request,
  context: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await context.params;
    const sb = supabaseAdmin();

    // Load conditions and context
    const [
      { data: conditions },
      { data: attachments },
      { data: requirements },
    ] = await Promise.all([
      (sb as any)
        .from("conditions_to_close")
        .select("*")
        .eq("application_id", dealId),
      (sb as any)
        .from("borrower_attachments")
        .select("*")
        .eq("application_id", dealId),
      (sb as any)
        .from("borrower_requirements_snapshots")
        .select("*")
        .eq("application_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single(),
    ]);

    if (!conditions || conditions.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No conditions to evaluate",
        triggers: [],
        drafts: [],
      });
    }

    // Calculate summary
    const total = conditions.length;
    const satisfied = conditions.filter((c: any) => c.satisfied).length;
    const required = conditions.filter(
      (c: any) => c.severity === "REQUIRED",
    ).length;
    const requiredSatisfied = conditions.filter(
      (c: any) => c.severity === "REQUIRED" && c.satisfied,
    ).length;

    const summary = {
      total,
      satisfied,
      remaining: total - satisfied,
      required,
      required_remaining: required - requiredSatisfied,
      completion_pct: total > 0 ? Math.round((satisfied / total) * 100) : 0,
      ready: required === requiredSatisfied,
    };

    // Evaluate triggers (deterministic rules)
    const triggers = evaluateTriggers(dealId, conditions, summary);

    // Process each trigger through throttle and draft
    const drafts = [];
    const skipped = [];

    for (const trigger of triggers) {
      // Check throttle
      const throttle = await checkThrottle(
        dealId,
        trigger.condition_id,
        trigger.trigger_type,
      );

      if (!throttle.eligible) {
        // Skip and record reason
        const messageId = await queueMessage(
          dealId,
          trigger.condition_id,
          {
            subject: `[SKIPPED] ${trigger.reason}`,
            body: throttle.reason || "Throttled",
            channel: "PORTAL",
            priority: trigger.priority,
            ai_generated: true,
            metadata: {
              trigger_type: trigger.trigger_type,
              condition_title: "",
              ai_explanation: "",
            },
          },
          { status: "DRAFT" },
        );

        await skipMessage(messageId, throttle.reason!, {
          throttle_result: throttle,
          trigger,
        });

        skipped.push({
          trigger,
          throttle,
          message_id: messageId,
        });
        continue;
      }

      // Find condition details
      const condition = conditions.find(
        (c: any) => c.id === trigger.condition_id,
      );
      if (!condition) continue;

      // AI draft message (explain only, no state changes)
      const draft = aiDraftMessage(condition, trigger.trigger_type, {
        attachments: attachments || [],
        requirements: requirements?.result,
      });

      // Queue as DRAFT (requires approval by default)
      const messageId = await queueMessage(
        dealId,
        trigger.condition_id,
        draft,
        {
          requiresApproval: true,
          status: "DRAFT",
        },
      );

      drafts.push({
        message_id: messageId,
        trigger,
        draft,
        throttle,
      });
    }

    return NextResponse.json({
      ok: true,
      triggers: triggers.length,
      drafts: drafts.length,
      skipped: skipped.length,
      details: {
        triggers,
        drafts,
        skipped,
      },
    });
  } catch (err: any) {
    console.error("Message planning failed:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "planning_failed" },
      { status: 500 },
    );
  }
}

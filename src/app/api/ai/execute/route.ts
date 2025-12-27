import { withApiGuard } from "@/lib/api/withApiGuard";
import { NextResponse } from "next/server";
import { BuddyAction } from "@/lib/ai/schemas";
import { executeAction } from "@/lib/ai/executor";
import { logAudit } from "@/lib/db/audit";

export const runtime = "nodejs";

export const POST = withApiGuard({ tag: "ai:execute", requireAuth: true, rate: { limit: 30, windowMs: 60_000 } }, async (req: any) => {
  try {
    const body = await req.json().catch(() => ({}));

    const dealId = body?.dealId ? String(body.dealId) : "DEAL-DEMO-001";
    const approved = Boolean(body?.approved);

    // Validate action strictly (only allowed types/shape)
    const parsed = BuddyAction.safeParse(body?.action);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid action payload", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const action = parsed.data;

    // Authority gate:
    // - TIER_3 requires explicit approval from user interaction (approved=true)
    if (action.authority === "TIER_3" && !approved) {
      const audit = logAudit({
        actor: "HUMAN",
        dealId,
        actionType: action.type,
        authority: action.authority,
        approved: false,
        title: action.title,
        payload: action.payload ?? {},
        result: "REJECTED",
        message: "TIER_3 action blocked: missing approved=true",
      });

      return NextResponse.json(
        {
          error: "Approval required for TIER_3 action",
          audit,
          hint: "Re-submit with { approved: true } after user confirmation.",
        },
        { status: 403 },
      );
    }

    // Execute safely via controlled switch (no arbitrary code)
    const result = await executeAction({ dealId, action });

    const audit = logAudit({
      actor: action.authority === "TIER_3" ? "HUMAN" : "AI",
      dealId,
      actionType: action.type,
      authority: action.authority,
      approved: action.authority === "TIER_3" ? true : approved, // approved might be true/false; tier_3 implies explicit
      title: action.title,
      payload: action.payload ?? {},
      result: result.ok ? "APPLIED" : "FAILED",
      message: result.message,
    });

    return NextResponse.json({ result, audit });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
});

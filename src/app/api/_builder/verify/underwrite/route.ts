import "server-only";

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureUnderwritingActivated } from "@/lib/deals/underwriting/ensureUnderwritingActivated";
import { initializeIntake } from "@/lib/deals/intake/initializeIntake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEDGER_KEYS = {
  entryHit: "underwriting.entry.hit",
  intakeInitialized: "pipeline.intake.initialized",
  intakeAlreadyInitialized: "pipeline.intake.already_initialized",
  underwritingActivated: "underwriting.activated",
  underwritingAlreadyActivated: "underwriting.already_activated",
} as const;

export async function GET(req: Request) {
  if (process.env.BUDDY_BUILDER_MODE !== "1") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const dealId = searchParams.get("dealId");

  if (!dealId) {
    return NextResponse.json({ ok: false, error: "missing_deal_id" }, { status: 400 });
  }

  try {
    const sb = supabaseAdmin();
    const intakeResult = await initializeIntake(dealId, null, {
      reason: "builder-verify",
      trigger: "underwrite.page",
    });

    const underwritingResult = await ensureUnderwritingActivated({
      dealId,
      trigger: "builder.verify",
    });

    const { count: checklistCount } = await sb
      .from("deal_checklist_items")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);

    const { data: ledgerEvents } = await sb
      .from("deal_pipeline_ledger")
      .select("event_key, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(50);

    const ledgerKeys = new Set((ledgerEvents ?? []).map((event: any) => event.event_key));

    const intakeEvent = ledgerKeys.has(LEDGER_KEYS.intakeInitialized)
      ? "initialized"
      : ledgerKeys.has(LEDGER_KEYS.intakeAlreadyInitialized)
        ? "already_initialized"
        : null;

    const underwritingEvent = ledgerKeys.has(LEDGER_KEYS.underwritingActivated)
      ? "activated"
      : ledgerKeys.has(LEDGER_KEYS.underwritingAlreadyActivated)
        ? "already_activated"
        : null;

    const entryHit = ledgerKeys.has(LEDGER_KEYS.entryHit);

    return NextResponse.json({
      ok: true,
      dealId,
      intake: {
        initialized: Boolean(intakeResult.ok && intakeResult.intakeInitialized),
        checklistCount: checklistCount ?? 0,
      },
      underwriting: {
        activated:
          underwritingResult.ok &&
          (underwritingResult.status === "activated" ||
            underwritingResult.status === "already_activated"),
      },
      ledger: {
        entryHit,
        intakeEvent,
        underwritingEvent,
      },
    });
  } catch (error: any) {
    console.error("[builder.verify.underwrite] failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "verify_failed" },
      { status: 500 },
    );
  }
}
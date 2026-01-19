import "server-only";

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureUnderwritingActivated } from "@/lib/deals/underwriting/ensureUnderwritingActivated";
import { initializeIntake } from "@/lib/deals/intake/initializeIntake";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEDGER_KEYS = {
  entryHit: "underwriting.entry.hit",
  intakeInitialized: "pipeline.intake.initialized",
  intakeAlreadyInitialized: "pipeline.intake.already_initialized",
  underwritingActivated: "underwriting.activated",
  underwritingAlreadyActivated: "underwriting.already_activated",
} as const;

const VERIFY_EVENTS = {
  start: "builder.verify.start",
  context: "builder.verify.context.fetch",
  pipeline: "builder.verify.pipeline.latest",
  activation: "builder.verify.underwrite.activation.check",
  done: "builder.verify.done",
  fail: "builder.verify.fail",
} as const;

const buildResponse = (status: number, payload: Record<string, unknown>) => {
  const response = NextResponse.json(payload, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
};

export async function GET(req: Request) {
  const token = req.headers.get("x-buddy-builder-token") ?? "";
  const expectedToken = process.env.BUDDY_BUILDER_VERIFY_TOKEN ?? "";

  if (!expectedToken || token !== expectedToken) {
    return buildResponse(401, {
      ok: false,
      auth: false,
      error: "unauthorized",
      message: "Missing or invalid builder verify token.",
    });
  }

  const { searchParams } = new URL(req.url);
  const dealId = searchParams.get("dealId");

  if (!dealId) {
    return buildResponse(400, { ok: false, auth: true, error: "missing_deal_id" });
  }

  const sb = supabaseAdmin();
  const ledgerEventsWritten: string[] = [];
  const logVerify = async (
    eventKey: string,
    uiMessage: string,
    bankId: string | null,
    meta?: Record<string, unknown>,
  ) => {
    if (!bankId) return;
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey,
      uiState: "done",
      uiMessage,
      meta: {
        deal_id: dealId,
        bank_id: bankId,
        source: "builder.verify",
        ...meta,
      },
    });
    ledgerEventsWritten.push(eventKey);
  };

  try {
    const { data: deal } = await sb
      .from("deals")
      .select("id, bank_id, lifecycle_stage")
      .eq("id", dealId)
      .maybeSingle();

    const bankId = deal?.bank_id ? String(deal.bank_id) : null;

    await logVerify(VERIFY_EVENTS.start, "Builder verify started", bankId);

    if (!deal) {
      await logVerify(VERIFY_EVENTS.fail, "Deal not found", bankId, {
        reason: "deal_not_found",
      });
      return buildResponse(404, {
        ok: false,
        auth: true,
        dealId,
        contextFetch: { ok: false, status: 404, error: "deal_not_found" },
        recommendedNextAction: "deal_not_found",
        ledgerEventsWritten,
      });
    }

    const intakeResult = await initializeIntake(dealId, bankId, {
      reason: "builder-verify",
      trigger: "underwrite.page",
    });

    const underwritingResult = await ensureUnderwritingActivated({
      dealId,
      bankId,
      trigger: "builder.verify",
    });

    await logVerify(VERIFY_EVENTS.context, "Builder verify context fetched", bankId, {
      lifecycle_stage: deal.lifecycle_stage ?? null,
      intake_status: intakeResult.ok ? intakeResult.status : "failed",
    });

    const { count: checklistCount } = await sb
      .from("deal_checklist_items")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);

    const { data: pipelineLatest } = await sb
      .from("deal_pipeline_ledger")
      .select("event_key, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    await logVerify(VERIFY_EVENTS.pipeline, "Builder verify pipeline latest", bankId, {
      latest_event_key: pipelineLatest?.event_key ?? null,
    });

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

    const underwritingActivated =
      underwritingResult.ok &&
      (underwritingResult.status === "activated" ||
        underwritingResult.status === "already_activated");

    await logVerify(VERIFY_EVENTS.activation, "Builder verify underwriting check", bankId, {
      underwriting_status: underwritingResult.ok ? underwritingResult.status : "failed",
    });

    const recommendedNextAction = underwritingActivated
      ? "visit_underwriting_surface"
      : underwritingResult.status === "blocked"
        ? "collect_required_documents"
        : "review_activation_failure";

    await logVerify(VERIFY_EVENTS.done, "Builder verify done", bankId, {
      checklist_count: checklistCount ?? 0,
      underwriting_status: underwritingResult.ok ? underwritingResult.status : "failed",
    });

    return buildResponse(200, {
      ok: true,
      auth: true,
      dealId,
      contextFetch: {
        ok: true,
        status: 200,
      },
      pipelineLatest: {
        ok: true,
        latestEventKey: pipelineLatest?.event_key ?? null,
        latestEventAt: pipelineLatest?.created_at ?? null,
      },
      intake: {
        initialized: Boolean(intakeResult.ok && intakeResult.intakeInitialized),
        checklistCount: checklistCount ?? 0,
      },
      underwriting: {
        activated: underwritingActivated,
        status: underwritingResult.ok ? underwritingResult.status : "failed",
        lifecycleStage: deal.lifecycle_stage ?? null,
      },
      ledger: {
        entryHit,
        intakeEvent,
        underwritingEvent,
      },
      recommendedNextAction,
      ledgerEventsWritten,
    });
  } catch (error: any) {
    console.error("[builder.verify.underwrite] failed", error);
    return buildResponse(500, {
      ok: false,
      auth: true,
      dealId,
      error: error?.message ?? "verify_failed",
      recommendedNextAction: "review_activation_failure",
      ledgerEventsWritten,
    });
  }
}
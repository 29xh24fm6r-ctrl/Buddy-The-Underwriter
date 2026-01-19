import StitchRouteBridge from "@/components/stitch/StitchRouteBridge";
import { DealOutputsPanel } from "@/components/deals/DealOutputsPanel";
import DealNameInlineEditor from "@/components/deals/DealNameInlineEditor";
import { CopyToClipboardButton } from "@/components/deals/DealOutputActions";
import DealFinancialSpreadsPanel from "@/components/deals/DealFinancialSpreadsPanel";
import MatchedLendersPanel from "@/components/deals/MatchedLendersPanel";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { resolveDealLabel, dealLabel } from "@/lib/deals/dealLabel";
import { canAccessUnderwrite } from "@/lib/deals/lifecycleGuards";
import { initializeIntake } from "@/lib/deals/intake/initializeIntake";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { emitBuilderLifecycleSignal } from "@/lib/buddy/builderSignals";
import { ensureUnderwritingActivated } from "@/lib/deals/underwriting/ensureUnderwritingActivated";
import { UnderwritingControlPanel } from "@/components/deals/UnderwritingControlPanel";
import { UnderwriteEntryRedirect } from "@/components/deals/UnderwriteEntryRedirect";
import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function generateMetadata(
  props: { params: Promise<{ dealId: string }> | { dealId: string } }
): Promise<Metadata> {
  try {
    const resolvedParams = await props.params;
    const dealId = resolvedParams.dealId;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return { title: "Underwriting • Buddy" };
    }

    const sb = supabaseAdmin();
    const { data: deal } = await sb
      .from("deals")
      .select("id, borrower_name, name, display_name, nickname")
      .eq("id", dealId)
      .eq("bank_id", access.bankId)
      .maybeSingle();

    if (!deal) {
      return { title: "Underwriting • Buddy" };
    }

    const title = dealLabel({
      id: String((deal as any).id ?? dealId),
      display_name: (deal as any).display_name ?? null,
      nickname: (deal as any).nickname ?? null,
      borrower_name: (deal as any).borrower_name ?? null,
      name: (deal as any).name ?? null,
    });

    return { title: `${title} • Buddy` };
  } catch {
    return { title: "Underwriting • Buddy" };
  }
}

type UnderwriteDealPageProps = {
  params: Promise<{ dealId: string }> | { dealId: string };
};

export default async function UnderwriteDealPage({
  params,
}: UnderwriteDealPageProps) {
  const resolvedParams = await params;
  const dealId = resolvedParams.dealId;
  const builderMode = process.env.BUDDY_BUILDER_MODE === "1";
  const setEntryHeader = async (value: "hit" | "bank" | "init" | "error") => {
    if (!builderMode) return;
    try {
      const responseHeaders = await headers();
      responseHeaders.set("x-buddy-underwrite-entry", value);
    } catch (e) {
      console.warn("[underwrite] unable to set entry header", e);
    }
  };

  const sb = supabaseAdmin();
  const { data: dealBankRow } = await sb
    .from("deals")
    .select("bank_id")
    .eq("id", dealId)
    .maybeSingle();

  const dealBankId = dealBankRow?.bank_id ? String(dealBankRow.bank_id) : null;

  const logUnderwriteLedger = async (
    eventKey: string,
    uiMessage: string,
    meta?: Record<string, unknown>,
    bankIdOverride?: string | null,
  ) => {
    const bankIdForLog = bankIdOverride ?? dealBankId;
    if (!builderMode || !bankIdForLog) return;
    await logLedgerEvent({
      dealId,
      bankId: bankIdForLog,
      eventKey,
      uiState: "done",
      uiMessage,
      meta: {
        deal_id: dealId,
        bank_id: bankIdForLog,
        trigger: "underwrite.page",
        ...meta,
      },
    });
  };

  try {
    await logUnderwriteLedger("underwrite.entry.hit", "Underwrite entry hit", {
      source: "system",
    });
  } catch (e) {
    console.warn("[underwrite] failed to log entry hit", e);
  }

  await setEntryHeader("hit");

  if (builderMode) {
    console.info("[underwrite] entry hit", { dealId, bankId: dealBankId ?? "unknown" });
    void emitBuilderLifecycleSignal({
      dealId,
      phase: "underwrite.entry",
      state: "hit",
      trigger: "underwrite.page",
      note: "Underwrite entry hit",
    });
  }

  let bankId: string | null = null;
  try {
    bankId = await getCurrentBankId();
    await logUnderwriteLedger(
      "underwrite.entry.bank_resolved",
      "Underwrite entry bank resolved",
      {
        source: "system",
        resolved_bank_id: bankId,
      },
      bankId,
    );
    await setEntryHeader("bank");
    if (builderMode) {
      console.info("[underwrite] bank resolved", { dealId, bankId });
      void emitBuilderLifecycleSignal({
        dealId,
        phase: "underwrite.entry",
        state: "bank_resolved",
        trigger: "underwrite.page",
        note: `Resolved bankId ${bankId}`,
      });
    }
  } catch (err) {
    await logUnderwriteLedger("underwrite.entry.error", "Underwrite entry bank resolve failed", {
      source: "system",
      error: (err as any)?.message ?? String(err),
    });
    await setEntryHeader("error");
    if (builderMode) {
      console.warn("[underwrite] bank resolve failed", err);
      void emitBuilderLifecycleSignal({
        dealId,
        phase: "underwrite.entry",
        state: "error",
        trigger: "underwrite.page",
        note: (err as any)?.message ?? String(err),
      });
    }
  }

  try {
    const intakeResult = await initializeIntake(dealId, bankId ?? dealBankId, {
      trigger: "underwrite.page",
    });
    await logUnderwriteLedger(
      "underwrite.entry.intake_result",
      "Underwrite entry intake result",
      {
        source: "system",
        result: intakeResult.ok ? intakeResult.status : "failed",
        error: intakeResult.ok ? null : intakeResult.error,
      },
      bankId ?? dealBankId,
    );
    await setEntryHeader("init");
    if (builderMode) {
      console.info("[underwrite] intake init result", {
        dealId,
        status: intakeResult.ok ? intakeResult.status : "failed",
        error: intakeResult.ok ? null : intakeResult.error,
      });
      void emitBuilderLifecycleSignal({
        dealId,
        phase: "underwrite.entry",
        state: intakeResult.ok ? intakeResult.status : "failed",
        trigger: "underwrite.page",
        note: intakeResult.ok ? "Underwrite intake init complete" : intakeResult.error,
      });
    }
  } catch (err) {
    await logUnderwriteLedger(
      "underwrite.entry.error",
      "Underwrite entry intake failed",
      {
        source: "system",
        error: (err as any)?.message ?? String(err),
      },
      bankId ?? dealBankId,
    );
    await setEntryHeader("error");
    console.error("[underwrite] intake auto-init failed", err);
  }

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="rounded-xl border border-neutral-200 bg-white p-6">
          <h1 className="text-2xl font-bold text-neutral-900">Underwriting</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Unable to access underwriting for this deal.
          </p>
          <div className="mt-4">
            <Link
              href={`/deals/${dealId}/cockpit`}
              className="inline-flex items-center rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-800"
            >
              Go to Deal Cockpit
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { data: deal } = await sb
    .from("deals")
    .select("id, borrower_name, name, display_name, nickname, stage, lifecycle_stage")
    .eq("id", dealId)
    .eq("bank_id", access.bankId)
    .maybeSingle();

  if (!deal) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="rounded-xl border border-neutral-200 bg-white p-6">
          <h1 className="text-2xl font-bold text-neutral-900">Underwriting</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Underwriting not started yet.
          </p>
          <div className="mt-4">
            <Link
              href={`/deals/${dealId}/cockpit`}
              className="inline-flex items-center rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-800"
            >
              Go to Deal Cockpit
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const activation = await ensureUnderwritingActivated({
    dealId,
    bankId: bankId ?? dealBankId ?? access.bankId,
    trigger: "underwrite.page",
  });

  const underwriteReady =
    (activation.ok && activation.status === "activated") ||
    canAccessUnderwrite(deal.lifecycle_stage ?? null);

  const { data: intake } = await sb
    .from("deal_intake")
    .select("id")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (!underwriteReady) {
    return (
      <div className="space-y-6 pb-10">
        {builderMode ? (
          <UnderwriteEntryRedirect dealId={dealId} enabled />
        ) : null}
        <div className="mx-auto w-full max-w-6xl px-4 pt-6">
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-bold text-neutral-900">Underwriting initialization</h1>
              <p className="text-sm text-neutral-600">
                Underwriting needs activation or required documents before analysis can begin.
              </p>
              <div className="text-xs text-neutral-500">
                Status: {activation.ok ? activation.status : "failed"}
              </div>
            </div>
            <div className="mt-4">
              <UnderwritingControlPanel
                dealId={dealId}
                lifecycleStage={deal.lifecycle_stage ?? null}
                intakeInitialized={Boolean(intake?.id)}
              />
            </div>
            <div className="mt-4">
              <Link
                href={`/deals/${dealId}/cockpit`}
                className="inline-flex items-center rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-800"
              >
                Go to Deal Cockpit
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const labelResult = resolveDealLabel({
    id: deal.id,
    display_name: (deal as any).display_name ?? null,
    nickname: (deal as any).nickname ?? null,
    borrower_name: deal.borrower_name ?? null,
    name: deal.name ?? null,
    legal_name: (deal as any).legal_name ?? null,
  });

  const { data: checklistRows } = await sb
    .from("deal_checklist_items")
    .select("id, title, required, status")
    .eq("deal_id", dealId);

  const requiredItems = (checklistRows ?? []).filter((r: any) => r.required);
  const receivedRequired = requiredItems.filter(
    (r: any) => r.status === "received" || r.status === "satisfied",
  );
  const missingRequired = requiredItems.filter(
    (r: any) => r.status !== "received" && r.status !== "satisfied",
  );

  return (
    <div className="space-y-6 pb-10">
      <div className="mx-auto w-full max-w-6xl px-4 pt-6">
        <div className="flex flex-col gap-3">
          <span className="inline-flex w-fit items-center rounded-full bg-neutral-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
            Underwriting
          </span>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-neutral-900">Underwriting</h1>
              <DealNameInlineEditor
                dealId={dealId}
                displayName={(deal as any).display_name ?? null}
                nickname={(deal as any).nickname ?? null}
                borrowerName={deal.borrower_name ?? null}
                legalName={(deal as any).legal_name ?? null}
                size="lg"
              />
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                <span>Deal ID {dealId}</span>
                <CopyToClipboardButton label="Copy Deal ID" text={dealId} />
                {labelResult.needsName ? (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                    Needs name
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4">
        <div className="grid gap-4 md:grid-cols-2 mb-6">
          <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-neutral-900">Checklist snapshot</div>
            <div className="mt-2 text-xs text-neutral-600">
              Required received: {receivedRequired.length}/{requiredItems.length}
            </div>
            {missingRequired.length > 0 ? (
              <div className="mt-3 text-xs text-neutral-600">
                Missing:
                <ul className="mt-2 space-y-1">
                  {missingRequired.slice(0, 5).map((item: any) => (
                    <li key={item.id}>• {item.title}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="mt-3 text-xs text-emerald-700">All required documents received.</div>
            )}
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-neutral-900">Ask Buddy about this deal</div>
            <div className="mt-2 text-xs text-neutral-600">
              Ask questions like “What’s missing?” or “Summarize borrower strength.”
            </div>
          </div>
        </div>
        <div className="mb-6">
          <DealFinancialSpreadsPanel dealId={dealId} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <DealOutputsPanel dealId={dealId} />
          <MatchedLendersPanel dealId={dealId} />
        </div>
      </div>
      <StitchRouteBridge
        slug="deals-command-bridge"
        activationContext={{ dealId }}
      />
    </div>
  );
}

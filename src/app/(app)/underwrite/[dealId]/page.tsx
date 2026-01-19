import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { dealLabel } from "@/lib/deals/dealLabel";
import { initializeIntake } from "@/lib/deals/intake/initializeIntake";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { emitBuilderLifecycleSignal } from "@/lib/buddy/builderSignals";
import { ensureUnderwritingActivated } from "@/lib/deals/underwriting/ensureUnderwritingActivated";
import { CopyToClipboardButton } from "@/components/deals/DealOutputActions";
import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

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
    const errorCopy =
      access.error === "unauthorized"
        ? "Authentication required to view this deal."
        : access.error === "tenant_mismatch"
          ? "Tenant context missing or does not match this deal."
          : "Deal not found.";
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="rounded-xl border border-neutral-200 bg-white p-6">
          <h1 className="text-2xl font-bold text-neutral-900">Underwriting</h1>
          <p className="mt-2 text-sm text-neutral-600">
            {errorCopy}
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
            Deal not found.
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

  const activated =
    activation.ok &&
    (activation.status === "activated" ||
      activation.status === "already_activated");

  if (activated) {
    redirect(`/deals/${dealId}/underwriter`);
  }

  const { data: latestLedger } = await sb
    .from("deal_pipeline_ledger")
    .select("id, event_key, created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const debugPayload = {
    dealId,
    bankId: access.bankId,
    activation: activation.ok ? activation.status : "failed",
    error: activation.ok ? null : activation.error,
    ledger: latestLedger ?? null,
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="rounded-xl border border-neutral-200 bg-white p-6">
        <h1 className="text-2xl font-bold text-neutral-900">Underwriting activation failed</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Underwriting could not be activated automatically. Please review the
          diagnostics below or open the cockpit to resolve missing requirements.
        </p>
        <div className="mt-4 text-xs text-neutral-500">
          Status: {activation.ok ? activation.status : "failed"}
        </div>
        {latestLedger ? (
          <div className="mt-4 text-xs text-neutral-500">
            Latest ledger: {latestLedger.event_key} at {latestLedger.created_at}
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <CopyToClipboardButton
            label="Copy debug"
            text={JSON.stringify(debugPayload, null, 2)}
          />
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

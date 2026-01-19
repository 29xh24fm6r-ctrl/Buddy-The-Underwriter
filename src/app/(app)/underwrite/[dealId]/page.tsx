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
import Link from "next/link";
import type { Metadata } from "next";

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

  const bankId = await getCurrentBankId();

  try {
    await initializeIntake(dealId, bankId, {
      trigger: "underwrite.page",
    });
  } catch (err) {
    console.error("[underwrite] intake auto-init failed", err);
  }

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
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

  const sb = supabaseAdmin();
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

  if (!canAccessUnderwrite(deal.lifecycle_stage ?? null)) {
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

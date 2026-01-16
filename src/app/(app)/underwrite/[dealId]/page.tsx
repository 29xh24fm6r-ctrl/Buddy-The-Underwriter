import StitchRouteBridge from "@/components/stitch/StitchRouteBridge";
import { DealOutputsPanel } from "@/components/deals/DealOutputsPanel";
import DealNameInlineEditor from "@/components/deals/DealNameInlineEditor";
import { CopyToClipboardButton } from "@/components/deals/DealOutputActions";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { resolveDealLabel } from "@/lib/deals/dealLabel";

export const dynamic = "force-dynamic";

type UnderwriteDealPageProps = {
  params: Promise<{ dealId: string }> | { dealId: string };
};

export default async function UnderwriteDealPage({
  params,
}: UnderwriteDealPageProps) {
  const resolvedParams = await params;
  const dealId = resolvedParams.dealId;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="rounded-xl border border-neutral-200 bg-white p-6">
          <h1 className="text-2xl font-bold text-neutral-900">Underwriting</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Deal not found or you don’t have access.
          </p>
        </div>
      </div>
    );
  }

  const sb = supabaseAdmin();
  const { data: deal } = await sb
    .from("deals")
    .select("id, borrower_name, name, display_name, nickname, stage")
    .eq("id", dealId)
    .eq("bank_id", access.bankId)
    .maybeSingle();

  if (!deal) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="rounded-xl border border-neutral-200 bg-white p-6">
          <h1 className="text-2xl font-bold text-neutral-900">Underwriting</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Deal not found or you don’t have access.
          </p>
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
  });

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
        <DealOutputsPanel dealId={dealId} />
      </div>
      <StitchRouteBridge
        slug="deals-command-bridge"
        activationContext={{ dealId }}
      />
    </div>
  );
}

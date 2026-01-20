import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { dealLabel } from "@/lib/deals/dealLabel";
import { ensureUnderwritingActivated } from "@/lib/deals/underwriting/ensureUnderwritingActivated";
import { verifyUnderwrite } from "@/lib/deals/verifyUnderwrite";
import StitchSurface from "@/stitch/StitchSurface";
import { UnderwriteBlockedPanel } from "@/components/underwrite/UnderwriteBlockedPanel";
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

export default async function DealUnderwritePage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const access = await ensureDealBankAccess(dealId);
  const verify = await verifyUnderwrite({ dealId, actor: "system" });
  if (!verify.ok) {
    let verifyLedger: any = null;
    if (access.ok) {
      const sb = supabaseAdmin();
      const { data: latestVerify } = await sb
        .from("deal_pipeline_ledger")
        .select("created_at, meta")
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId)
        .eq("event_key", "deal.underwrite.verify")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestVerify?.meta) {
        verifyLedger = {
          ...(latestVerify.meta as any),
          createdAt: latestVerify.created_at ?? null,
        };
      }
    }
    return (
      <UnderwriteBlockedPanel
        dealId={dealId}
        verify={verify}
        verifyLedger={verifyLedger}
      />
    );
  }

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

  const activation = await ensureUnderwritingActivated({
    dealId,
    bankId: access.bankId,
    trigger: "underwrite.page",
  });

  const activated =
    activation.ok &&
    (activation.status === "activated" ||
      activation.status === "already_activated");

  if (activated) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <StitchSurface surfaceKey="underwrite" dealId={dealId} title="Underwrite" mode="iframe" />
      </div>
    );
  }

  const sb = supabaseAdmin();
  const { data: latestLedger } = await sb
    .from("deal_pipeline_ledger")
    .select("id, event_key, created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

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

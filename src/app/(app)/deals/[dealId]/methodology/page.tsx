import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { loadDealMethodology } from "@/lib/methodology/loadDealMethodology";
import {
  METHODOLOGY_AXES,
  ALL_METHODOLOGY_AXIS_IDS,
} from "@/lib/methodology/methodologyAxes";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { MethodologyPickerClient } from "./MethodologyPickerClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ dealId: string }> };

/**
 * SPEC-B4 — Methodology picker page.
 *
 * Server component:
 *   - Auths via ensureDealBankAccess
 *   - Loads current effective slate + axis catalog + current canonical values
 *   - Passes everything to the client component for radio-driven interaction
 */
export default async function MethodologyPickerPage({ params }: PageProps) {
  const { dealId } = await params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) notFound();
  const bankId = (access as any).bankId as string;

  const { slate, choices, isAllDefaults } = await loadDealMethodology(dealId, bankId);

  const allFactKeys = Array.from(
    new Set(
      ALL_METHODOLOGY_AXIS_IDS.flatMap(
        (axisId) => METHODOLOGY_AXES[axisId].affectedFactKeys,
      ),
    ),
  );

  const sb = supabaseAdmin();
  const { data: factRows } = await (sb as any)
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num, updated_at")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("is_superseded", false)
    .neq("resolution_status", "rejected")
    .in("fact_key", allFactKeys)
    .order("updated_at", { ascending: false });

  const currentValues: Record<string, number | null> = {};
  for (const key of allFactKeys) currentValues[key] = null;
  for (const row of (factRows ?? []) as any[]) {
    if (currentValues[row.fact_key] === null) {
      currentValues[row.fact_key] = row.fact_value_num;
    }
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Conservative methodology
        </h1>
        <p className="text-sm text-gray-600 mt-2">
          Chosen by Buddy, refined by you. Each axis represents a credit decision
          that affects how DSCR, EBITDA, or Global Cash Flow is computed for this deal.
        </p>
      </header>

      <Suspense fallback={<div>Loading...</div>}>
        <MethodologyPickerClient
          dealId={dealId}
          slate={slate}
          choices={choices}
          isAllDefaults={isAllDefaults}
          axes={METHODOLOGY_AXES}
          currentValues={currentValues}
        />
      </Suspense>
    </div>
  );
}

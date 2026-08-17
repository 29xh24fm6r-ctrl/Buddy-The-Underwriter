import "server-only";

import Link from "next/link";
import { GoldenTridentLabClient } from "@/components/brokerage/GoldenTridentLabClient";
import { GoldenTridentFixtureButton } from "@/components/brokerage/GoldenTridentFixtureButton";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { getTridentReadiness, type TridentReadiness } from "@/lib/brokerage/trident/tridentReadiness";
import { gradeGoldenTrident, type GoldenTridentQualityReport } from "@/lib/brokerage/trident/goldenTridentQuality";
import { getAICommissioningReadiness } from "@/lib/ai/commissioningReadiness";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ dealId?: string }>;

function ArtifactCard(props: { title: string; note: string; href?: string | null; action?: string }) {
  return (
    <article className="rounded-lg border border-[#5d4b32] bg-[#211c15] p-4">
      <h2 className="font-semibold text-[#f2e9d8]">{props.title}</h2>
      <p className="mt-1 min-h-10 text-sm text-[#a99b84]">{props.note}</p>
      {props.href ? (
        <Link className="mt-3 inline-block text-sm font-semibold text-[#d5ad61] underline" href={props.href} target="_blank">
          {props.action ?? "Open artifact"}
        </Link>
      ) : (
        <p className="mt-3 text-sm text-amber-300">Not generated</p>
      )}
    </article>
  );
}

export async function GoldenTridentLab({ searchParams }: { searchParams: SearchParams }) {
  const dealId = (await searchParams).dealId?.trim() ?? "";
  const sb = supabaseAdmin();
  const brokerageBankId = await getBrokerageBankId();

  let deal: Record<string, unknown> | null = null;
  let assumptions: Record<string, unknown> | null = null;
  let bundle: Record<string, unknown> | null = null;
  let loadError: string | null = null;
  let readiness: TridentReadiness | null = null;
  let quality: GoldenTridentQualityReport | null = null;
  const signed: Record<string, string | null> = {};
  const aiReadiness = await getAICommissioningReadiness(sb);

  if (dealId) {
    const [dealResult, assumptionsResult, bundleResult] = await Promise.all([
      sb.from("deals").select("id, display_name, borrower_name, loan_amount, state, status, is_test, bank_id").eq("id", dealId).eq("bank_id", brokerageBankId).maybeSingle(),
      sb.from("buddy_sba_assumptions").select("*").eq("deal_id", dealId).maybeSingle(),
      sb.from("buddy_trident_bundles").select("*").eq("deal_id", dealId).eq("mode", "final").is("superseded_at", null).order("generated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    loadError = dealResult.error?.message ?? assumptionsResult.error?.message ?? bundleResult.error?.message ?? null;
    deal = dealResult.data as Record<string, unknown> | null;
    assumptions = assumptionsResult.data as Record<string, unknown> | null;
    bundle = bundleResult.data as Record<string, unknown> | null;

    if (deal) {
      [readiness, quality] = await Promise.all([
        getTridentReadiness({ sb, dealId, bankId: brokerageBankId }),
        gradeGoldenTrident({ sb, dealId, bankId: brokerageBankId }),
      ]);
    }

    if (bundle?.status === "succeeded") {
      for (const [key, column] of Object.entries({
        businessPlan: "business_plan_pdf_path",
        projectionsPdf: "projections_pdf_path",
        projectionsXlsx: "projections_xlsx_path",
        feasibility: "feasibility_pdf_path",
      })) {
        const path = bundle[column];
        if (typeof path === "string" && path) {
          const result = await sb.storage.from("trident-bundles").createSignedUrl(path, 3600);
          signed[key] = result.data?.signedUrl ?? null;
        }
      }
    }
  }

  return (
    <main className="space-y-6 p-6 text-[#f2e9d8]">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#b68b3c]">Artifact quality lab</p>
        <h1 className="mt-1 text-3xl font-semibold">Golden Trident Test Drive</h1>
        <p className="mt-2 max-w-3xl text-sm text-[#b9ad99]">
          Choose a real brokerage deal with completed uploads. Generation uses the production engines and preserves evidence provenance; it does not seal, list, or modify marketplace state.
        </p>
      </header>

      <section className={`rounded-lg border p-4 ${aiReadiness.fullyCommissioned ? "border-emerald-700 bg-emerald-950/20" : "border-amber-700 bg-amber-950/20"}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b68b3c]">AI production commissioning</p>
            <h2 className="mt-1 text-xl font-semibold">{aiReadiness.fullyCommissioned ? "Three-provider chain commissioned" : "Three-provider chain not commissioned"}</h2>
          </div>
          <span className={`rounded px-2 py-1 text-xs font-semibold ${aiReadiness.fullyCommissioned ? "bg-emerald-900/60 text-emerald-200" : "bg-amber-900/60 text-amber-200"}`}>
            {aiReadiness.providers.filter((provider) => provider.commissioned).length}/3 ready
          </span>
        </div>
        <p className="mt-2 text-sm text-[#b9ad99]">A provider is ready only when its credential exists, borrower-NPI use is approved, and the production ledger contains a successful call.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {aiReadiness.providers.map((provider) => (
            <article key={provider.provider} className="rounded border border-[#5d4b32] bg-[#211c15] p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{provider.label}</h3>
                <span className={provider.commissioned ? "text-emerald-300" : "text-amber-300"}>{provider.commissioned ? "READY" : "BLOCKED"}</span>
              </div>
              <p className="mt-1 text-xs text-[#a99b84]">{provider.roles}</p>
              <ul className="mt-3 space-y-1 text-xs">
                <li>Credential: {provider.credentialConfigured ? "configured" : "missing"}</li>
                <li>NPI approval: {provider.npiApproved ? "approved" : "pending"}</li>
                <li>30-day calls: {provider.recentSuccesses} succeeded / {provider.recentFailures} failed</li>
                <li>Last success: {provider.lastSuccessAt ? new Date(provider.lastSuccessAt).toLocaleString() : "none"}</li>
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-[#5d4b32] bg-[#211c15] p-4">
        <h2 className="mb-2 font-semibold">Commissioning deal</h2>
        <GoldenTridentFixtureButton />
      </section>

      <form className="flex max-w-3xl gap-3" method="get">
        <input type="hidden" name="lab" value="golden-trident" />
        <input name="dealId" defaultValue={dealId} required placeholder="Deal UUID" className="min-w-0 flex-1 rounded-md border border-[#5d4b32] bg-[#17130f] px-3 py-2 font-mono text-sm" />
        <button className="rounded-md border border-[#8b7350] px-4 py-2 text-sm font-semibold">Load deal</button>
      </form>

      {loadError ? <p className="rounded-md border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">{loadError}</p> : null}
      {dealId && !deal && !loadError ? <p className="text-amber-300">No brokerage deal found for that ID.</p> : null}

      {deal ? (
        <>
          <section className="rounded-lg border border-[#5d4b32] bg-[#211c15] p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{String(deal.display_name ?? deal.borrower_name ?? deal.id)}</h2>
                <p className="font-mono text-xs text-[#8f826f]">{String(deal.id)}</p>
              </div>
              <p className="text-sm text-[#b9ad99]">{deal.is_test ? "TEST DEAL" : "LIVE DEAL — generation creates new artifact versions"}</p>
            </div>
            <div className="mt-4">
              <GoldenTridentLabClient dealId={dealId} readiness={readiness} />
            </div>
            {bundle?.status === "failed" ? <p className="mt-3 rounded bg-red-950/40 p-3 text-sm text-red-200">Generation stopped: {String(bundle.generation_error ?? "unknown error")}</p> : null}
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <ArtifactCard title="Business plan" note="Full generated plan PDF, including narratives and financial sections." href={signed.businessPlan} />
            <ArtifactCard title="Projections" note="Final-mode Excel workbook with monthly, annual, sensitivity, sources-and-uses, and balance-sheet tabs." href={signed.projectionsXlsx ?? signed.projectionsPdf} action="Open workbook" />
            <ArtifactCard title="Feasibility study" note="Independent feasibility output produced by the Trident engine." href={signed.feasibility} />
            <ArtifactCard title="Financial spreads" note="Runs the canonical aggregation, preflight, narrative, and classic spread PDF renderer." href={`/api/deals/${dealId}/classic-spread`} />
            <ArtifactCard title="Credit memo" note="Review the canonical memo; generate its narrative above when prerequisites are ready." href={`/deals/${dealId}/credit-memo`} action="Review memo" />
            <ArtifactCard title="Credit memo PDF" note="Committee-formatted PDF. Its safety gate will identify missing certified inputs." href={`/api/deals/${dealId}/credit-memo/canonical/pdf`} />
          </section>

          {quality ? (
            <section className="rounded-lg border border-[#5d4b32] bg-[#17130f] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b68b3c]">Deterministic commissioning scorecard</p>
                  <h2 className="mt-1 text-2xl font-semibold">Overall {quality.overallScore}/100</h2>
                </div>
                <p className="max-w-2xl text-xs text-[#a99b84]">Structural grading catches missing, thin, incomplete, or unverified outputs. Lender judgment of writing quality remains a separate UAT step.</p>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {quality.artifacts.map((item) => (
                  <article key={item.key} className="rounded-md border border-[#4f422f] bg-[#211c15] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-semibold">{item.label}</h3>
                      <span className={`rounded px-2 py-1 text-xs font-semibold ${item.status === "pass" ? "bg-emerald-900/50 text-emerald-200" : item.status === "review" ? "bg-amber-900/50 text-amber-200" : "bg-red-950/60 text-red-200"}`}>{item.score}/100 · {item.status}</span>
                    </div>
                    {item.passed.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-emerald-200/90">{item.passed.map((line) => <li key={line}>{line}</li>)}</ul> : null}
                    {item.findings.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-200">{item.findings.map((line) => <li key={line}>{line}</li>)}</ul> : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-lg border border-[#5d4b32] bg-[#17130f] p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Confirmed projection assumptions</h2>
              <span className="text-xs uppercase tracking-wide text-[#b68b3c]">{String(assumptions?.status ?? "missing")}</span>
            </div>
            {assumptions ? (
              <pre className="mt-3 max-h-[34rem] overflow-auto whitespace-pre-wrap rounded bg-black/30 p-4 text-xs text-[#d8cdbb]">{JSON.stringify(assumptions, null, 2)}</pre>
            ) : (
              <p className="mt-3 text-sm text-amber-300">No assumptions record. Complete and confirm borrower projections assumptions before generating.</p>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}

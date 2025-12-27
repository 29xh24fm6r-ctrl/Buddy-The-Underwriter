import { generateRiskAction } from "../../_actions/aiActions";
import { getLatestRiskRun } from "@/lib/db/server";
import type { EvidenceRef } from "@/lib/evidence/types";
import Link from "next/link";
import { evidenceUrl } from "@/lib/evidence/url";

function fmtContribution(n: number) {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  const abs = Math.abs(n).toFixed(2);
  return `${sign}${abs}`;
}

function EvidenceChips({ dealId, evidence }: { dealId: string; evidence: EvidenceRef[] }) {
  if (!evidence?.length) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {evidence.slice(0, 4).map((e, i) => (
        <Link
          key={i}
          href={evidenceUrl(dealId, e)}
          className="inline-flex items-center gap-2 rounded-full border border-border-dark bg-[#0f1115] px-2 py-1 text-[11px] text-muted-foreground hover:bg-[#121622]"
          title={e.excerpt ?? ""}
        >
          <span className="material-symbols-outlined text-[14px]">attach_file</span>
          {e.label ?? e.sourceId}
          {e.page ? <span>· p.{e.page}</span> : null}
          <span className="material-symbols-outlined text-[14px] opacity-70">open_in_new</span>
        </Link>
      ))}
    </div>
  );
}

export default async function DealRiskPricingPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const latest = await getLatestRiskRun(dealId);
  const risk = latest?.outputs as any | null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Explainable Risk & Pricing</div>
          <div className="text-sm text-muted-foreground">
            AI generates drivers + pricing rationale with traceable evidence.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href={`/deals/${dealId}/risk/compare`} className="rounded-lg border border-border-dark bg-[#0f1115] px-3 py-1.5 text-sm hover:bg-[#121622]">What changed?</Link>
          <form action={async () => { "use server"; await generateRiskAction(dealId); }}>
            <button className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
              Generate Risk (AI)
            </button>
          </form>
        </div>
      </div>

      {!risk ? (
        <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4">
          <div className="text-sm font-semibold">No risk run yet</div>
          <div className="mt-2 text-sm text-muted-foreground">
            Click <span className="font-medium text-white">Generate Risk (AI)</span> to create drivers and pricing rationale.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Risk grade">
              <div className="text-3xl font-semibold">{risk.grade}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Latest run: <span className="font-mono">{latest?.id?.slice(0, 8)}</span>
              </div>
            </Panel>

            <Panel title="Pricing">
              <div className="text-xl font-semibold">
                SOFR + {(risk.baseRateBps ?? 0) + (risk.riskPremiumBps ?? 0)} bps
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Base: {risk.baseRateBps} • Premium: {risk.riskPremiumBps}
              </div>
            </Panel>

            <Panel title="Confidence">
              <div className="text-xl font-semibold">Demo</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Next: aggregate factor confidence → show band.
              </div>
            </Panel>
          </div>

          <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4">
            <div className="text-sm font-semibold">Drivers</div>

            <div className="mt-3 space-y-3">
              {(risk.factors ?? []).map((f: any, idx: number) => (
                <div key={idx} className="rounded-xl border border-border-dark bg-[#0f1115] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{f.label}</div>
                      <div className="mt-1 text-[12px] text-muted-foreground">
                        {f.category} • {f.direction} • confidence {(Number(f.confidence) * 100).toFixed(0)}%
                      </div>
                    </div>
                    <div className="rounded-lg border border-border-dark bg-[#0b0d10] px-2 py-1 text-sm font-semibold">
                      {fmtContribution(Number(f.contribution))}
                    </div>
                  </div>

                  {f.rationale ? (
                    <div className="mt-2 text-sm text-muted-foreground">{f.rationale}</div>
                  ) : null}

                  <EvidenceChips dealId={dealId} evidence={f.evidence ?? []} />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4">
            <div className="text-sm font-semibold">Pricing breakdown</div>
            <div className="mt-3 space-y-3">
              {(risk.pricingExplain ?? []).map((p: any, idx: number) => (
                <div key={idx} className="rounded-xl border border-border-dark bg-[#0f1115] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-semibold">{p.label}</div>
                    <div className="rounded-lg border border-border-dark bg-[#0b0d10] px-2 py-1 text-sm font-semibold">
                      +{p.bps} bps
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">{p.rationale}</div>
                  <EvidenceChips dealId={dealId} evidence={p.evidence ?? []} />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4">
            <div className="text-sm font-semibold">Next</div>
            <div className="mt-2 text-sm text-muted-foreground">
              Go to Memo and click <span className="font-medium text-white">Generate Memo (AI)</span>.
              Every paragraph will carry citations back to evidence.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

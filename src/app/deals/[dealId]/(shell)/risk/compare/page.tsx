import Link from "next/link";
import { listRiskRuns } from "@/lib/db/server";
import { diffRisk } from "@/lib/diff/riskDiff";

export default async function DealRiskComparePage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const runs = await listRiskRuns(dealId);

  if (runs.length < 2) {
    return (
      <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4">
        <div className="text-sm font-semibold">Not enough risk runs to compare</div>
        <div className="mt-2 text-sm text-muted-foreground">Generate risk at least twice.</div>
        <div className="mt-3">
          <Link className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white" href={`/deals/${dealId}/risk`}>
            Back to Risk
          </Link>
        </div>
      </div>
    );
  }

  const [latest, prev] = runs;
  const d = diffRisk(prev.outputs, latest.outputs);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold">What changed? (Risk)</div>
        <div className="text-sm text-muted-foreground">
          Comparing <span className="font-mono">{prev.id.slice(0, 8)}</span> → <span className="font-mono">{latest.id.slice(0, 8)}</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Grade">
          <div className="text-xl font-semibold">
            {d.grade.from} → {d.grade.to}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">{d.grade.changed ? "Changed" : "Unchanged"}</div>
        </Panel>

        <Panel title="Pricing (SOFR spread)">
          <div className="text-xl font-semibold">
            {d.pricing.totalBpsFrom} → {d.pricing.totalBpsTo} bps
          </div>
          <div className="mt-1 text-sm text-muted-foreground">Δ {d.pricing.delta} bps</div>
        </Panel>

        <Panel title="Drivers changed">
          <div className="text-xl font-semibold">
            {d.factorChanges.filter((x) => x.status !== "unchanged").length}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">added/removed/changed</div>
        </Panel>
      </div>

      <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4">
        <div className="text-sm font-semibold">Factor deltas</div>
        <div className="mt-3 space-y-2">
          {d.factorChanges.map((c) => (
            <div key={c.label} className="flex items-center justify-between gap-3 rounded-lg border border-border-dark bg-[#0f1115] px-3 py-2">
              <div className="text-sm">{c.label}</div>
              <div className="text-[12px] text-muted-foreground">
                {c.status === "added" ? `added (${c.to})` : null}
                {c.status === "removed" ? `removed (${c.from})` : null}
                {c.status === "changed" ? `${c.from} → ${c.to} (Δ ${c.delta})` : null}
                {c.status === "unchanged" ? "unchanged" : null}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <Link className="rounded-lg border border-border-dark bg-[#0f1115] px-3 py-1.5 text-sm hover:bg-[#121622]" href={`/deals/${dealId}/risk`}>
            Back to Risk
          </Link>
        </div>
      </div>
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

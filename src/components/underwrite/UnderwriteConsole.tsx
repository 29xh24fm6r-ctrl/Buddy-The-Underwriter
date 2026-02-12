"use client";

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types (local — mirrors API response shapes)
// ---------------------------------------------------------------------------

interface ArtifactSummary {
  id: string;
  version: number;
  status: string;
  productType: string;
  tier: string;
  recommendation: string;
  overallHash: string;
  createdBy: string | null;
  createdAt: string;
}

interface ArtifactDetail {
  id: string;
  version: number;
  status: string;
  productType: string;
  snapshotJson: any;
  analysisJson: any;
  policyJson: any;
  stressJson: any;
  pricingJson: any;
  memoJson: any;
  hashes: {
    modelHash: string;
    snapshotHash: string;
    policyHash: string;
    stressHash: string;
    pricingHash: string;
    memoHash: string;
    overallHash: string;
  };
  engineVersion: string;
  createdBy: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIER_COLORS: Record<string, string> = {
  A: "bg-emerald-50 text-emerald-800 border-emerald-200",
  B: "bg-blue-50 text-blue-800 border-blue-200",
  C: "bg-amber-50 text-amber-800 border-amber-200",
  D: "bg-red-50 text-red-800 border-red-200",
};

const REC_COLORS: Record<string, string> = {
  APPROVE: "bg-emerald-100 text-emerald-900",
  APPROVE_WITH_MITIGANTS: "bg-amber-100 text-amber-900",
  DECLINE_OR_RESTRUCTURE: "bg-red-100 text-red-900",
};

function fmtPct(n: number): string {
  return (n * 100).toFixed(2) + "%";
}

function fmtNum(n: number | undefined | null): string {
  if (n === undefined || n === null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface Props {
  dealId: string;
  bankId: string;
}

export default function UnderwriteConsole({ dealId }: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ArtifactSummary[]>([]);
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Load artifact history
  const loadHistory = useCallback(async () => {
    const res = await fetch(`/api/deals/${dealId}/underwrite/artifacts`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (data.ok) setHistory(data.artifacts ?? []);
  }, [dealId]);

  // Load artifact detail
  const loadDetail = useCallback(
    async (artifactId: string) => {
      setLoadingDetail(true);
      const res = await fetch(
        `/api/deals/${dealId}/underwrite/artifacts/${artifactId}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (data.ok) setDetail(data.artifact);
      setLoadingDetail(false);
    },
    [dealId],
  );

  // Run underwrite
  const runUnderwrite = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/underwrite/run`, {
        method: "POST",
        cache: "no-store",
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Pipeline failed");
      } else {
        await loadHistory();
        if (data.artifactId) await loadDetail(data.artifactId);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  }, [dealId, loadHistory, loadDetail]);

  // Initial load
  useEffect(() => {
    loadHistory().then(() => {
      // Auto-load latest artifact if exists
    });
  }, [loadHistory]);

  // Auto-load latest on history change
  useEffect(() => {
    if (history.length > 0 && !detail) {
      loadDetail(history[0].id);
    }
  }, [history, detail, loadDetail]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Underwrite Console
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Deterministic institutional underwriting pipeline
          </p>
        </div>
        <button
          onClick={runUnderwrite}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Running..." : "Run Underwrite"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Active artifact detail */}
      {loadingDetail && (
        <div className="py-10 text-center text-sm text-slate-400">
          Loading artifact...
        </div>
      )}

      {detail && !loadingDetail && (
        <div className="space-y-4">
          {/* Version + Status badge */}
          <div className="flex items-center gap-3">
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
              v{detail.version}
            </span>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">
              {detail.status}
            </span>
            <span className="text-xs text-slate-400">
              {fmtDate(detail.createdAt)}
            </span>
            <span className="ml-auto font-mono text-[10px] text-slate-400">
              {detail.hashes.overallHash.slice(0, 12)}...
            </span>
          </div>

          {/* Snapshot Metrics */}
          <Section title="Snapshot Metrics">
            <MetricsTable snapshot={detail.snapshotJson} />
          </Section>

          {/* Policy Evaluation */}
          <Section title="Policy Evaluation">
            <PolicyPanel policy={detail.policyJson} />
          </Section>

          {/* Stress Comparison */}
          <Section title="Stress Analysis">
            <StressPanel stress={detail.stressJson} />
          </Section>

          {/* Pricing Breakdown */}
          <Section title="Pricing">
            <PricingPanel pricing={detail.pricingJson} />
          </Section>

          {/* Memo Preview */}
          <Section title="Credit Memo">
            <MemoPanel memo={detail.memoJson} />
          </Section>
        </div>
      )}

      {/* Artifact History */}
      {history.length > 0 && (
        <Section title="Artifact History">
          <div className="divide-y divide-slate-100">
            {history.map((a) => (
              <button
                key={a.id}
                onClick={() => loadDetail(a.id)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-slate-50 ${
                  detail?.id === a.id ? "bg-indigo-50" : ""
                }`}
              >
                <span className="font-semibold text-slate-700">
                  v{a.version}
                </span>
                <TierBadge tier={a.tier} />
                <span className="text-slate-500">{a.recommendation}</span>
                <span className="text-xs text-slate-400">
                  {a.status}
                </span>
                <span className="ml-auto text-xs text-slate-400">
                  {fmtDate(a.createdAt)}
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {!detail && !loadingDetail && history.length === 0 && !running && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm text-slate-500">
            No underwrite artifacts yet. Click &ldquo;Run Underwrite&rdquo; to
            run the full pipeline.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
      >
        {title}
        <span className="text-slate-400">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="border-t border-slate-100 px-4 py-3">{children}</div>}
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const color = TIER_COLORS[tier] ?? "bg-slate-100 text-slate-600";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold ${color}`}
    >
      Tier {tier}
    </span>
  );
}

function MetricsTable({ snapshot }: { snapshot: any }) {
  if (!snapshot?.ratios?.metrics) {
    return <p className="text-sm text-slate-400">No metrics available</p>;
  }

  const metrics = snapshot.ratios.metrics;
  const rows = Object.entries(metrics).filter(
    ([, v]) => v && typeof (v as any).value === "number",
  );

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
          <th className="py-2">Metric</th>
          <th className="py-2 text-right">Value</th>
          <th className="py-2 text-right">Formula</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {rows.map(([key, val]) => (
          <tr key={key}>
            <td className="py-2 font-medium text-slate-700">{key}</td>
            <td className="py-2 text-right tabular-nums">{fmtNum((val as any).value)}</td>
            <td className="py-2 text-right text-xs text-slate-400">
              {(val as any).formula ?? "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PolicyPanel({ policy }: { policy: any }) {
  if (!policy) return <p className="text-sm text-slate-400">No policy data</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <TierBadge tier={policy.tier ?? "—"} />
        <span className="text-sm text-slate-600">
          {policy.passed ? "All thresholds met" : `${policy.failedMetrics?.length ?? 0} breach(es)`}
        </span>
      </div>

      {policy.breaches?.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="py-2">Metric</th>
              <th className="py-2">Severity</th>
              <th className="py-2 text-right">Actual</th>
              <th className="py-2 text-right">Deviation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {policy.breaches.map((b: any, i: number) => (
              <tr key={i}>
                <td className="py-2 font-medium text-slate-700">{b.metric}</td>
                <td className="py-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                      b.severity === "severe"
                        ? "bg-red-50 text-red-700"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {b.severity}
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums">
                  {fmtNum(b.actualValue)}
                </td>
                <td className="py-2 text-right tabular-nums text-slate-500">
                  {fmtPct(b.deviation)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {policy.warnings?.length > 0 && (
        <div className="mt-2 text-xs text-amber-600">
          {policy.warnings.map((w: string, i: number) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function StressPanel({ stress }: { stress: any }) {
  if (!stress?.scenarios) {
    return <p className="text-sm text-slate-400">No stress data</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <TierBadge tier={stress.worstTier ?? "—"} />
        <span className="text-sm text-slate-600">
          {stress.tierDegraded
            ? "Tier degradation detected under stress"
            : "No tier degradation under stress"}
        </span>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="py-2">Scenario</th>
            <th className="py-2">Tier</th>
            <th className="py-2 text-right">DSCR Delta</th>
            <th className="py-2 text-right">DS Delta</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {stress.scenarios.map((s: any) => (
            <tr key={s.key}>
              <td className="py-2 font-medium text-slate-700">{s.label}</td>
              <td className="py-2">
                <TierBadge tier={s.policy?.tier ?? "—"} />
              </td>
              <td className="py-2 text-right tabular-nums">
                {s.dscrDelta !== undefined
                  ? (s.dscrDelta >= 0 ? "+" : "") + s.dscrDelta.toFixed(3)
                  : "—"}
              </td>
              <td className="py-2 text-right tabular-nums">
                {s.debtServiceDelta !== undefined
                  ? "$" + fmtNum(s.debtServiceDelta)
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PricingPanel({ pricing }: { pricing: any }) {
  if (!pricing) return <p className="text-sm text-slate-400">No pricing data</p>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-slate-500">Base Rate</p>
          <p className="text-lg font-bold text-slate-900 tabular-nums">
            {fmtPct(pricing.baseRate)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Risk Premium</p>
          <p className="text-lg font-bold text-slate-900 tabular-nums">
            +{pricing.riskPremiumBps}bps
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Stress Adj.</p>
          <p className="text-lg font-bold text-slate-900 tabular-nums">
            +{pricing.stressAdjustmentBps}bps
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Final Rate</p>
          <p className="text-lg font-bold text-indigo-700 tabular-nums">
            {fmtPct(pricing.finalRate)}
          </p>
        </div>
      </div>

      {pricing.rationale?.length > 0 && (
        <div className="mt-2 space-y-1 text-xs text-slate-500">
          {pricing.rationale.map((r: string, i: number) => (
            <p key={i}>{r}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function MemoPanel({ memo }: { memo: any }) {
  if (!memo?.sections) {
    return <p className="text-sm text-slate-400">No memo data</p>;
  }

  const rec = memo.recommendation;
  const recColor = REC_COLORS[rec] ?? "bg-slate-100 text-slate-600";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span
          className={`rounded-md px-3 py-1 text-xs font-bold ${recColor}`}
        >
          {(rec ?? "—").replace(/_/g, " ")}
        </span>
        <span className="text-sm text-slate-600">{memo.product}</span>
      </div>

      {Object.entries(memo.sections).map(([key, section]: [string, any]) => (
        <div key={key} className="border-l-2 border-slate-200 pl-3">
          <h4 className="text-xs font-semibold uppercase text-slate-500">
            {section.title}
          </h4>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
            {section.content}
          </p>
        </div>
      ))}
    </div>
  );
}

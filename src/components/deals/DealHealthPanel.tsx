"use client";

import { useState, useEffect } from "react";
import FinancialReviewItem from "@/components/deals/financial-review/FinancialReviewItem";
import {
  buildFinancialValidationViewModel,
  type ValidationGap,
  type FinancialPackageStatus,
  type EngineDisplayValue,
} from "@/lib/financialReview/financialValidationView";
import type { CanonicalFinancialEngineState } from "@/lib/financials/canonicalEngineState";

type Provenance = {
  value: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  confidence: number | null;
  sourceDocumentName: string | null;
  sourceLineLabel: string | null;
  extractionPath: string | null;
};

type DealHealthPanelProps = {
  dealId: string;
  onSessionStart?: () => void;
};

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatEngineValue(v: EngineDisplayValue): string {
  if (v.value === null || !Number.isFinite(v.value)) return "—";
  if (v.kind === "ratio") return `${v.value.toFixed(2)}x`;
  return currencyFmt.format(v.value);
}

const cardShell =
  "border border-white/10 rounded-lg overflow-hidden bg-white/[0.03]";
const headerShell =
  "px-4 py-3 bg-white/[0.04] border-b border-white/10 flex items-center justify-between";
const headerLabel =
  "text-xs font-semibold text-white/70 uppercase tracking-wide";

function EngineValuesGrid({ values }: { values: EngineDisplayValue[] }) {
  return (
    <div
      className="px-4 py-3 border-b border-white/5 grid grid-cols-2 gap-x-4 gap-y-2"
      data-testid="canonical-engine-values"
    >
      {values.map((v) => (
        <div key={v.factKey} className="flex items-center justify-between text-xs">
          <span className="text-white/40">{v.label}</span>
          <span
            className="font-semibold text-white/70 tabular-nums"
            data-engine-key={v.factKey}
          >
            {formatEngineValue(v)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function DealHealthPanel({ dealId, onSessionStart }: DealHealthPanelProps) {
  const [gaps, setGaps] = useState<ValidationGap[]>([]);
  const [completeness, setCompleteness] = useState<number>(0);
  const [snapshotExists, setSnapshotExists] = useState<boolean>(false);
  const [financialPackage, setFinancialPackage] = useState<FinancialPackageStatus | null>(null);
  const [canonicalEngine, setCanonicalEngine] = useState<CanonicalFinancialEngineState | null>(null);
  const [provenance, setProvenance] = useState<Record<string, Provenance>>({});
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);

  const load = async () => {
    setLoading(true);
    // Fetch the legacy gap-queue (review items + provenance + completeness) AND the
    // canonical financial engine state (canonical_engine + persisted package status)
    // so the card renders the SAME numbers as GCF / spreads / snapshots.
    const [gapRes, snapRes] = await Promise.all([
      fetch(`/api/deals/${dealId}/gap-queue`).then((r) => r.json()).catch(() => null),
      fetch(`/api/deals/${dealId}/financial-snapshot`, { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => null),
    ]);

    if (gapRes?.ok) {
      setGaps(gapRes.gaps ?? []);
      setCompleteness(gapRes.completenessScore ?? 0);
      setSnapshotExists(gapRes.financialSnapshotExists ?? false);
      setProvenance(gapRes.provenance ?? {});
    }
    if (snapRes?.ok) {
      setCanonicalEngine((snapRes.canonical_engine ?? snapRes.snapshot?.canonical_engine ?? null) as CanonicalFinancialEngineState | null);
      setFinancialPackage((snapRes.financialPackage ?? null) as FinancialPackageStatus | null);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [dealId]);

  const recover = async () => {
    setRecovering(true);
    try {
      // snapshot/generate persists the snapshot + decision rows atomically; when a
      // snapshot row exists without a decision its decision-count gate is 0, so this
      // completes the orphaned package (no fake success — surfaces server errors).
      await fetch(`/api/deals/${dealId}/snapshot/generate`, { method: "POST" }).catch(() => {});
      await load();
    } finally {
      setRecovering(false);
    }
  };

  const vm = buildFinancialValidationViewModel({
    loading,
    financialSnapshotExists: snapshotExists,
    financialPackage,
    canonicalEngine,
    gaps,
    completeness,
  });

  const barColor =
    vm.completeness >= 80 ? "bg-emerald-500" : vm.completeness >= 50 ? "bg-amber-500" : "bg-rose-500";

  if (vm.status === "loading") {
    return (
      <div className="border border-white/10 rounded-lg p-4 animate-pulse bg-white/[0.03]">
        <div className="h-4 bg-white/10 rounded w-1/3 mb-3" />
        <div className="h-2 bg-white/10 rounded" />
      </div>
    );
  }

  // ── STATE A: No reviewable snapshot yet ───────────────────────────────
  if (vm.status === "no_snapshot") {
    return (
      <div className={cardShell}>
        <div className="px-4 py-3 bg-white/[0.04] border-b border-white/10">
          <span className={headerLabel}>Financial Validation</span>
        </div>
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-white/50 mb-1">No banker review needed yet.</p>
          <p className="text-xs text-white/35 mb-4 max-w-sm mx-auto leading-relaxed">
            Buddy has not assembled a reviewable financial snapshot with supporting evidence.
            Upload financial statements, complete spreads, and generate the snapshot first.
          </p>
          <a
            href={`/deals/${dealId}/cockpit`}
            className="inline-block text-xs font-semibold bg-white/10 text-white/70 px-3 py-1.5 rounded-md hover:bg-white/15 transition-colors"
          >
            Go to Financials
          </a>
        </div>
      </div>
    );
  }

  // ── STATE B: Snapshot persisted but decision row missing → recoverable ─
  if (vm.status === "recoverable_decision_missing") {
    return (
      <div className={cardShell}>
        <div className={headerShell}>
          <span className={headerLabel}>Financial Validation</span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
            Needs rebuild
          </span>
        </div>
        <EngineValuesGrid values={vm.engineValues} />
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-white/60 mb-1">Financial package is incomplete.</p>
          <p className="text-xs text-white/40 mb-4 max-w-sm mx-auto leading-relaxed">
            A financial snapshot was created but its review decision did not persist. Rebuild
            the package to finish — your data is intact and this is safe to retry.
          </p>
          <button
            onClick={recover}
            disabled={recovering}
            className="inline-block text-xs font-semibold bg-amber-500/20 text-amber-200 px-3 py-1.5 rounded-md hover:bg-amber-500/30 transition-colors disabled:opacity-50"
          >
            {recovering ? "Rebuilding…" : "Rebuild financial package"}
          </button>
        </div>
      </div>
    );
  }

  // ── STATE C: Engine prerequisites missing → GCF-ordered diagnostics ────
  if (vm.status === "prerequisites_missing" && vm.prerequisites) {
    const unmet = vm.prerequisites.ordered.filter((p) => !p.satisfied);
    return (
      <div className={cardShell}>
        <div className={headerShell}>
          <span className={headerLabel}>Financial Validation</span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300">
            Prerequisites needed
          </span>
        </div>
        <EngineValuesGrid values={vm.engineValues} />
        <div className="px-4 py-3 border-b border-white/5">
          <p className="text-xs text-white/40 mb-2">
            Global cash flow can&apos;t finish until these upstream inputs are produced (same
            order as the Global Cash Flow page):
          </p>
          <ol className="space-y-1.5">
            {unmet.map((p, i) => (
              <li key={p.key} className="flex items-start gap-2 text-xs" data-prereq-key={p.key}>
                <span
                  className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                    i === 0 ? "bg-rose-500/30 text-rose-200" : "bg-white/10 text-white/40"
                  }`}
                >
                  {i + 1}
                </span>
                <span className={i === 0 ? "text-white/70" : "text-white/45"}>{p.diagnostic}</span>
              </li>
            ))}
          </ol>
        </div>
        {vm.reviewItems.length > 0 && (
          <div className="divide-y divide-white/5">
            {vm.reviewItems.map((gap) => (
              <FinancialReviewItem
                key={gap.id}
                gap={gap as any}
                provenance={gap.fact_id ? provenance[gap.fact_id] ?? null : null}
                dealId={dealId}
                onResolved={load}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── STATE D: Prerequisites ready, no remaining review items ────────────
  if (vm.status === "ready_no_review") {
    return (
      <div className={cardShell}>
        <div className={headerShell}>
          <span className={headerLabel}>Financial Validation</span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
            No review needed
          </span>
        </div>
        <EngineValuesGrid values={vm.engineValues} />
        <div className="px-4 py-3 border-b border-white/5">
          <div className="flex items-center justify-between text-xs text-white/40 mb-1.5">
            <span>Data completeness</span>
            <span className="font-semibold text-white/60">{vm.completeness}%</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className={`h-1.5 ${barColor} rounded-full transition-all`} style={{ width: `${vm.completeness}%` }} />
          </div>
        </div>
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-white/50">Buddy has assembled a reviewable financial snapshot.</p>
          <p className="text-xs text-white/35 mt-1">
            Canonical financial values match Global Cash Flow and spreads. No banker review is currently required.
          </p>
        </div>
      </div>
    );
  }

  // ── STATE E: Snapshot ready, items require banker judgment ─────────────
  return (
    <div className={cardShell}>
      <div className={headerShell}>
        <div className="flex items-center gap-3">
          <span className={headerLabel}>Financial Validation</span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
            vm.reviewItems.length <= 2 ? "bg-amber-500/20 text-amber-300" : "bg-rose-500/20 text-rose-300"
          }`}>
            {vm.reviewItems.length} item{vm.reviewItems.length !== 1 ? "s" : ""} need{vm.reviewItems.length === 1 ? "s" : ""} review
          </span>
        </div>
        {onSessionStart && (
          <button
            onClick={onSessionStart}
            className="text-xs font-semibold bg-white/10 text-white/70 px-3 py-1.5 rounded-md hover:bg-white/15 flex items-center gap-1.5 transition-colors"
          >
            Start Financial Review
          </button>
        )}
      </div>

      <EngineValuesGrid values={vm.engineValues} />

      <div className="px-4 py-3 border-b border-white/5">
        <div className="flex items-center justify-between text-xs text-white/40 mb-1.5">
          <span>Data completeness</span>
          <span className="font-semibold text-white/60">{vm.completeness}%</span>
        </div>
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div className={`h-1.5 ${barColor} rounded-full transition-all`} style={{ width: `${vm.completeness}%` }} />
        </div>
      </div>

      <div className="divide-y divide-white/5">
        {vm.reviewItems.map((gap) => (
          <FinancialReviewItem
            key={gap.id}
            gap={gap as any}
            provenance={gap.fact_id ? provenance[gap.fact_id] ?? null : null}
            dealId={dealId}
            onResolved={load}
          />
        ))}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SnapshotPicker } from "@/components/deals/pricing-memo/SnapshotPicker";
import { MemoGenerator } from "@/components/deals/pricing-memo/MemoGenerator";
import { OutputsList } from "@/components/deals/pricing-memo/OutputsList";

type Snapshot = {
  id: string;
  version?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  context?: any;
};

type RiskFact = {
  id: string;
  created_at: string;
};

type PricingQuote = {
  id: string;
  status: string;
  created_at: string;
};

type GeneratedDocument = {
  id: string;
  doc_type: string;
  title: string;
  status: string;
  pdf_storage_path: string | null;
  created_at: string;
  content_json?: any;
};

export default function DealMemoTemplateClient({ dealId }: { dealId: string }) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);

  const [riskFacts, setRiskFacts] = useState<RiskFact | null>(null);
  const [pricingQuote, setPricingQuote] = useState<PricingQuote | null>(null);
  const [documents, setDocuments] = useState<GeneratedDocument[]>([]);

  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [loadingState, setLoadingState] = useState(false);

  const snapshotsForPicker = useMemo(() => {
    return snapshots.map((s) => ({
      id: s.id,
      version: s.version ?? 0,
      created_at: (s.created_at ?? s.updated_at ?? new Date().toISOString()) as string,
      context: s.context,
    }));
  }, [snapshots]);

  const loadSnapshots = useCallback(async () => {
    setLoadingSnapshots(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/snapshots`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error ?? "Failed to load snapshots");
      }

      const list: Snapshot[] = data.snapshots ?? [];
      setSnapshots(list);

      if (!selectedSnapshotId && list.length > 0) {
        setSelectedSnapshotId(list[0].id);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to load snapshots");
    } finally {
      setLoadingSnapshots(false);
    }
  }, [dealId, selectedSnapshotId]);

  const loadState = useCallback(
    async (snapshotId: string) => {
      setLoadingState(true);
      try {
        const res = await fetch(
          `/api/deals/${dealId}/pricing-memo/state?snapshotId=${encodeURIComponent(snapshotId)}`,
          { cache: "no-store" },
        );
        const data = await res.json();

        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error ?? "Failed to load memo state");
        }

        setRiskFacts(data.risk_facts ?? null);
        setPricingQuote(data.pricing_quote ?? null);
        setDocuments(data.documents ?? []);
      } catch (e) {
        console.error(e);
        alert("Failed to load memo state");
      } finally {
        setLoadingState(false);
      }
    },
    [dealId],
  );

  useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots]);

  useEffect(() => {
    if (!selectedSnapshotId) return;
    void loadState(selectedSnapshotId);
  }, [selectedSnapshotId, loadState]);

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Credit Memo</h1>
          <p className="mt-1 text-sm text-white/70">
            Generate memo JSON and render a banker-ready PDF.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Snapshot</div>
              {loadingSnapshots ? <div className="text-xs text-white/60">Loading…</div> : null}
            </div>
            <div className="mt-3">
              <SnapshotPicker
                snapshots={snapshotsForPicker as any}
                selectedId={selectedSnapshotId}
                onSelect={(id) => setSelectedSnapshotId(id || null)}
              />
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Derived State</div>
              {loadingState ? <div className="text-xs text-white/60">Loading…</div> : null}
            </div>
            <div className="mt-2 space-y-1 text-xs text-white/70">
              <div>Risk facts: {riskFacts ? "ready" : "none"}</div>
              <div>Pricing quote: {pricingQuote ? pricingQuote.status : "none"}</div>
              <div>Documents: {documents.length}</div>
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <MemoGenerator
            dealId={dealId}
            snapshotId={selectedSnapshotId}
            riskFactsId={riskFacts?.id ?? null}
            pricingQuoteId={pricingQuote?.id ?? null}
            documents={documents as any}
            onGenerated={(doc) => {
              setDocuments((prev) => {
                const next = [...prev];
                const idx = next.findIndex((d) => d.id === (doc as any).id);
                if (idx >= 0) next[idx] = doc as any;
                else next.unshift(doc as any);
                return next;
              });
            }}
          />

          <OutputsList dealId={dealId} documents={documents as any} />
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

type DealStatusBannerProps = {
  dealId: string;
};

type ReadinessState = {
  ready: boolean;
  reason: string | null;
};

export default function DealStatusBanner({ dealId }: DealStatusBannerProps) {
  const [state, setState] = useState<ReadinessState>({ ready: false, reason: null });
  const [loading, setLoading] = useState(true);

  async function fetchReadiness() {
    try {
      const res = await fetch(`/api/deals/${dealId}/readiness`);
      const json = await res.json();
      if (json.ok) {
        setState({ ready: json.ready, reason: json.reason });
      }
    } catch (e) {
      console.error("[DealStatusBanner] Failed to fetch readiness:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchReadiness();
    
    // Auto-refresh every 10 seconds
    const interval = setInterval(fetchReadiness, 10000);
    
    // Refresh on visibility change
    const onVis = () => {
      if (document.visibilityState === "visible") fetchReadiness();
    };
    document.addEventListener("visibilitychange", onVis);
    
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [dealId]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-neutral-700 bg-neutral-900/50 px-6 py-4">
        <div className="text-sm text-neutral-400">Checking readiness...</div>
      </div>
    );
  }

  if (state.ready) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="text-2xl">✅</div>
          <div>
            <div className="text-lg font-semibold text-emerald-100">Deal Ready</div>
            <div className="text-sm text-emerald-200/80">All requirements satisfied</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="text-2xl">⏳</div>
        <div>
          <div className="text-lg font-semibold text-amber-100">
            {state.reason || "Processing..."}
          </div>
          <div className="text-sm text-amber-200/80">
            The system is converging. No action required.
          </div>
        </div>
      </div>
    </div>
  );
}

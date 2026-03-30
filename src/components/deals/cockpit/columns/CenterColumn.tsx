"use client";

import { SafeBoundary } from "@/components/SafeBoundary";
import { CanonicalChecklistPanel } from "../panels/CanonicalChecklistPanel";
import PricingAssumptionsCard from "../panels/PricingAssumptionsCard";

const glassPanel = "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]";
const glassHeader = "border-b border-white/10 bg-white/[0.02] px-5 py-3";

type Props = {
  dealId: string;
};

export function CenterColumn({ dealId }: Props) {
  return (
    <div className="space-y-4">
      <SafeBoundary>
        <div className={glassPanel}>
          <div className={glassHeader}>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-emerald-400 text-[18px]">checklist</span>
              <span className="text-xs font-bold uppercase tracking-widest text-white/50">Document Checklist</span>
            </div>
          </div>
          <div className="p-4">
            <CanonicalChecklistPanel />
          </div>
        </div>
      </SafeBoundary>
      <SafeBoundary>
        <PricingAssumptionsCard dealId={dealId} />
      </SafeBoundary>
    </div>
  );
}

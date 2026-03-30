"use client";

import { SafeBoundary } from "@/components/SafeBoundary";
import { CanonicalCoreDocumentsPanel } from "../panels/CanonicalCoreDocumentsPanel";
import { ArtifactPipelinePanel } from "../panels/ArtifactPipelinePanel";
import { PipelinePanel } from "../panels/PipelinePanel";
import DealFilesCard from "@/components/deals/DealFilesCard";

const glassPanel = "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]";
const glassHeader = "border-b border-white/10 bg-white/[0.02] px-5 py-3";

type Props = {
  dealId: string;
  isAdmin?: boolean;
  gatekeeperPrimaryRouting?: boolean;
};

export function LeftColumn({ dealId, isAdmin = false }: Props) {
  return (
    <div className="space-y-4">
      <SafeBoundary>
        <div className={glassPanel}>
          <div className={glassHeader}>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-blue-400 text-[18px]">description</span>
              <span className="text-xs font-bold uppercase tracking-widest text-white/50">Core Documents</span>
            </div>
          </div>
          <div className="p-4">
            <CanonicalCoreDocumentsPanel />
          </div>
        </div>
      </SafeBoundary>
      <SafeBoundary>
        <ArtifactPipelinePanel dealId={dealId} />
      </SafeBoundary>
      <SafeBoundary>
        <PipelinePanel dealId={dealId} isAdmin={isAdmin} />
      </SafeBoundary>
      <SafeBoundary>
        <DealFilesCard dealId={dealId} />
      </SafeBoundary>
    </div>
  );
}

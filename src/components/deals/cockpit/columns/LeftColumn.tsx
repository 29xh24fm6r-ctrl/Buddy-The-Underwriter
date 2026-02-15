"use client";

import { SafeBoundary } from "@/components/SafeBoundary";
import { CoreDocumentsPanel } from "../panels/CoreDocumentsPanel";
import { ArtifactPipelinePanel } from "../panels/ArtifactPipelinePanel";
import { PipelinePanel } from "../panels/PipelinePanel";
import DealFilesCard from "@/components/deals/DealFilesCard";

type Props = {
  dealId: string;
  isAdmin?: boolean;
  gatekeeperPrimaryRouting?: boolean;
};

export function LeftColumn({ dealId, isAdmin = false, gatekeeperPrimaryRouting = false }: Props) {
  return (
    <div className="space-y-4">
      <SafeBoundary>
        <CoreDocumentsPanel dealId={dealId} gatekeeperPrimaryRouting={gatekeeperPrimaryRouting} />
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

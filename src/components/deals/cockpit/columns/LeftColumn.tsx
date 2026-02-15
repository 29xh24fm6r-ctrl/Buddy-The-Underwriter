"use client";

import { SafeBoundary } from "@/components/SafeBoundary";
import { CoreDocumentsPanel } from "../panels/CoreDocumentsPanel";
import { ArtifactPipelinePanel } from "../panels/ArtifactPipelinePanel";
import DealFilesCard from "@/components/deals/DealFilesCard";

type Props = {
  dealId: string;
  gatekeeperPrimaryRouting?: boolean;
};

export function LeftColumn({ dealId, gatekeeperPrimaryRouting = false }: Props) {
  return (
    <div className="space-y-4">
      <SafeBoundary>
        <CoreDocumentsPanel dealId={dealId} gatekeeperPrimaryRouting={gatekeeperPrimaryRouting} />
      </SafeBoundary>
      <SafeBoundary>
        <ArtifactPipelinePanel dealId={dealId} />
      </SafeBoundary>
      <SafeBoundary>
        <DealFilesCard dealId={dealId} />
      </SafeBoundary>
    </div>
  );
}

"use client";

import { SafeBoundary } from "@/components/SafeBoundary";
import { ArtifactPipelinePanel } from "../panels/ArtifactPipelinePanel";
import DealFilesCard from "@/components/deals/DealFilesCard";

type Props = {
  dealId: string;
};

export function LeftColumn({ dealId }: Props) {
  return (
    <div className="space-y-4">
      <SafeBoundary>
        <ArtifactPipelinePanel dealId={dealId} />
      </SafeBoundary>
      <SafeBoundary>
        <DealFilesCard dealId={dealId} />
      </SafeBoundary>
    </div>
  );
}

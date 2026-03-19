"use client";
import { SafeBoundary } from "@/components/SafeBoundary";
import DealFilesCard from "@/components/deals/DealFilesCard";
import { CoreDocumentsPanel } from "./CoreDocumentsPanel";
import { ArtifactPipelinePanel } from "./ArtifactPipelinePanel";

type Props = { dealId: string; isAdmin?: boolean; gatekeeperPrimaryRouting?: boolean };

export function DocumentsTabPanel({ dealId, isAdmin = false, gatekeeperPrimaryRouting = false }: Props) {
  return (
    <div className="space-y-4">
      <SafeBoundary><DealFilesCard dealId={dealId} /></SafeBoundary>
      <SafeBoundary><CoreDocumentsPanel dealId={dealId} gatekeeperPrimaryRouting={gatekeeperPrimaryRouting} /></SafeBoundary>
      <SafeBoundary><ArtifactPipelinePanel dealId={dealId} /></SafeBoundary>
    </div>
  );
}

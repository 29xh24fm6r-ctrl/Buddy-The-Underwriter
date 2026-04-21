"use client";

import { useState, useCallback } from "react";
import type { SBAAssumptions, SBAPackageData, PrefillMeta } from "@/lib/sba/sbaReadinessTypes";
import AssumptionInterview from "./AssumptionInterview";
import SBAPackageViewer from "./SBAPackageViewer";
import SBARiskProfilePanel from "./SBARiskProfilePanel";
import SBAGuaranteeCard from "./SBAGuaranteeCard";
import SBAEtranReadinessPanel from "./SBAEtranReadinessPanel";
import SBADiscoveryInterview from "./SBADiscoveryInterview";

interface BorrowerStorySummary {
  dealId: string;
  originStory: string | null;
  competitiveInsight: string | null;
  idealCustomer: string | null;
  growthStrategy: string | null;
  biggestRisk: string | null;
  personalVision: string | null;
}

interface Props {
  dealId: string;
  loanAmount: number;
  dealType: string | null;
  initialAssumptions: SBAAssumptions | null;
  initialPackage: SBAPackageData | null;
  prefilled: Partial<SBAAssumptions>;
  prefillMeta?: PrefillMeta | null;
  initialBorrowerStory?: BorrowerStorySummary | null;
}

function storyHasMinimum(story: BorrowerStorySummary | null | undefined): boolean {
  if (!story) return false;
  const nonEmpty = (s: string | null) =>
    typeof s === "string" && s.trim().length > 0;
  return (
    nonEmpty(story.originStory) &&
    nonEmpty(story.competitiveInsight) &&
    nonEmpty(story.growthStrategy)
  );
}

export default function SBAPackageTab({
  dealId,
  loanAmount,
  dealType,
  initialAssumptions,
  initialPackage,
  prefilled,
  prefillMeta,
  initialBorrowerStory,
}: Props) {
  const [packageData, setPackageData] = useState<SBAPackageData | null>(initialPackage);
  const [generating, setGenerating] = useState(false);
  const [discoveryComplete, setDiscoveryComplete] = useState<boolean>(
    storyHasMinimum(initialBorrowerStory ?? null),
  );

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const resp = await fetch(`/api/deals/${dealId}/sba/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await resp.json();
      if (data.ok && data.packageId) {
        // Fetch the full package
        const pkgResp = await fetch(`/api/deals/${dealId}/sba/latest`);
        const pkgData = await pkgResp.json();
        if (pkgData.package) {
          setPackageData(pkgData.package);
        }
      }
    } catch (err) {
      console.error("[SBAPackageTab] generate error:", err);
    } finally {
      setGenerating(false);
    }
  }, [dealId]);

  const handleSubmit = useCallback(async () => {
    try {
      const resp = await fetch(`/api/deals/${dealId}/sba/submit`, {
        method: "PATCH",
      });
      const data = await resp.json();
      if (data.ok && packageData) {
        setPackageData({ ...packageData, status: "submitted" });
      }
    } catch (err) {
      console.error("[SBAPackageTab] submit error:", err);
    }
  }, [dealId, packageData]);

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <h2 className="text-lg font-semibold text-white mb-4">
        SBA Borrower Readiness Package
      </h2>

      {/* Guarantee Card — very top */}
      <div className="mb-4">
        <SBAGuaranteeCard loanAmount={loanAmount} dealType={dealType} />
      </div>

      {/* E-Tran Readiness Panel */}
      <div className="mb-4">
        <SBAEtranReadinessPanel
          dealId={dealId}
          onNavigateToBuilder={(section) => {
            window.location.href = `../builder?section=${section}`;
          }}
        />
      </div>

      {/* Risk Profile Panel */}
      <div className="mb-4">
        <SBARiskProfilePanel dealId={dealId} />
      </div>

      <div className="flex gap-6">
        {/* Left panel: Discovery → Assumption Interview */}
        <div className="w-[55%] min-w-0 space-y-4">
          <SBADiscoveryInterview
            dealId={dealId}
            initialStory={initialBorrowerStory ?? null}
            onComplete={() => setDiscoveryComplete(true)}
          />

          {discoveryComplete ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5">
              <h3 className="text-sm font-semibold text-white/80 mb-3">
                Assumption Interview
              </h3>
              <AssumptionInterview
                dealId={dealId}
                initial={initialAssumptions}
                prefilled={prefilled}
                prefillMeta={prefillMeta}
                onConfirmed={handleGenerate}
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-sm p-5">
              <h3 className="text-sm font-semibold text-white/40 mb-2">
                Assumption Interview
              </h3>
              <p className="text-xs text-white/40 leading-relaxed">
                Complete or skip the discovery interview above to unlock the
                assumption interview.
              </p>
              <button
                type="button"
                onClick={() => setDiscoveryComplete(true)}
                className="mt-3 text-xs text-blue-400 hover:text-blue-300"
              >
                Skip discovery for now
              </button>
            </div>
          )}
        </div>

        {/* Right panel: Package Viewer */}
        <div className="w-[45%] min-w-0">
          {generating && !packageData && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5 flex items-center justify-center min-h-[300px]">
              <div className="text-center space-y-2">
                <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
                <p className="text-sm text-white/60">
                  Generating SBA package...
                </p>
              </div>
            </div>
          )}

          {packageData && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5">
              <h3 className="text-sm font-semibold text-white/80 mb-3">
                Generated Package
              </h3>
              <SBAPackageViewer
                dealId={dealId}
                pkg={packageData}
                generating={generating}
                onRegenerate={handleGenerate}
                onSubmit={handleSubmit}
              />
            </div>
          )}

          {!generating && !packageData && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5 flex items-center justify-center min-h-[300px]">
              <p className="text-sm text-white/40 text-center">
                Complete and confirm assumptions to generate the SBA package.
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

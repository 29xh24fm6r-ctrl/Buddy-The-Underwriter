"use client";

import { useState, useCallback } from "react";
import type { SBAAssumptions, SBAPackageData } from "@/lib/sba/sbaReadinessTypes";
import AssumptionInterview from "./AssumptionInterview";
import SBAPackageViewer from "./SBAPackageViewer";
import SBARiskProfilePanel from "./SBARiskProfilePanel";

interface Props {
  dealId: string;
  initialAssumptions: SBAAssumptions | null;
  initialPackage: SBAPackageData | null;
  prefilled: Partial<SBAAssumptions>;
}

export default function SBAPackageTab({
  dealId,
  initialAssumptions,
  initialPackage,
  prefilled,
}: Props) {
  const [packageData, setPackageData] = useState<SBAPackageData | null>(initialPackage);
  const [generating, setGenerating] = useState(false);

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

      {/* Risk Profile Panel — top of tab */}
      <div className="mb-4">
        <SBARiskProfilePanel dealId={dealId} />
      </div>

      <div className="flex gap-6">
        {/* Left panel: Assumption Interview */}
        <div className="w-[55%] min-w-0">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-5">
            <h3 className="text-sm font-semibold text-white/80 mb-3">
              Assumption Interview
            </h3>
            <AssumptionInterview
              dealId={dealId}
              initial={initialAssumptions}
              prefilled={prefilled}
              onConfirmed={handleGenerate}
            />
          </div>
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

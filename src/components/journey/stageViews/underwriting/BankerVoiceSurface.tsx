"use client";

import { SafeBoundary } from "@/components/SafeBoundary";
import BankerVoicePanel from "@/components/deals/BankerVoicePanel";
import DealHealthPanel from "@/components/deals/DealHealthPanel";
import { useStageDataContext } from "../_shared/StageDataProvider";
import { useRegisterStageRefresher } from "../_shared/useStageDataRefresh";

/**
 * SPEC-06 — Banker voice + deal health slice extracted from the legacy
 * StoryPanel.
 *
 * Mounts DealHealthPanel + BankerVoicePanel directly (preserving the
 * SPEC-02 placement invariant) and registers a remount-key refresher under
 * scope: "underwriting" so a refresh re-keys this surface specifically —
 * leaving the rest of the underwriting workbench untouched.
 */
export function BankerVoiceSurface({ dealId }: { dealId: string }) {
  const { refreshSeq } = useStageDataContext();
  useRegisterStageRefresher(
    "underwriting",
    "underwriting:banker-voice",
    () => {},
  );

  return (
    <div
      data-testid="underwriting-banker-voice-surface"
      key={`banker-voice-${refreshSeq}`}
      className="space-y-3"
    >
      <SafeBoundary>
        <DealHealthPanel dealId={dealId} />
      </SafeBoundary>
      <SafeBoundary>
        <BankerVoicePanel dealId={dealId} />
      </SafeBoundary>
    </div>
  );
}

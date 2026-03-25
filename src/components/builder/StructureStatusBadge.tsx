"use client";

import type { StructureStatusInfo } from "@/lib/governance/structureStatus";
import { STATUS_BADGE_STYLES } from "@/lib/governance/structureStatus";

type Props = {
  status: StructureStatusInfo;
};

export function StructureStatusBadge({ status }: Props) {
  const style = STATUS_BADGE_STYLES[status.status] ?? STATUS_BADGE_STYLES.working;

  return (
    <div className="flex items-center gap-2">
      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${style.cls}`}>
        {status.label}
      </span>
      {status.scenario_label && (
        <span className="text-[10px] text-white/30">{status.scenario_label}</span>
      )}
      {status.frozen_at && (
        <span className="text-[10px] text-white/20">
          Frozen {new Date(status.frozen_at).toLocaleDateString()}
        </span>
      )}
      {status.approved_at && (
        <span className="text-[10px] text-white/20">
          {new Date(status.approved_at).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}

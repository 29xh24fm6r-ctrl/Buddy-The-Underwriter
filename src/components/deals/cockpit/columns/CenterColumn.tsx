"use client";

import { SafeBoundary } from "@/components/SafeBoundary";
import { YearAwareChecklistPanel } from "../panels/YearAwareChecklistPanel";

type Props = {
  dealId: string;
};

export function CenterColumn({ dealId }: Props) {
  return (
    <div className="space-y-4">
      <SafeBoundary>
        <YearAwareChecklistPanel dealId={dealId} />
      </SafeBoundary>
    </div>
  );
}

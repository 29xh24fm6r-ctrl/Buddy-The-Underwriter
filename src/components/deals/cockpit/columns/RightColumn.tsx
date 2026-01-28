"use client";

import { SafeBoundary } from "@/components/SafeBoundary";
import { ReadinessPanel } from "../panels/ReadinessPanel";

type Props = {
  dealId: string;
  isAdmin?: boolean;
  onServerAction?: (action: string) => void;
  onAdvance?: () => void;
};

export function RightColumn({ dealId, isAdmin, onServerAction, onAdvance }: Props) {
  return (
    <div className="space-y-4">
      <SafeBoundary>
        <ReadinessPanel
          dealId={dealId}
          isAdmin={isAdmin}
          onServerAction={onServerAction}
          onAdvance={onAdvance}
        />
      </SafeBoundary>
    </div>
  );
}

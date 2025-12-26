"use client";

import type { DealContext } from "@/lib/deals/contextTypes";
import { useEffect } from "react";

export function StitchPanel({
  dealId,
  context,
}: {
  dealId: string;
  context: DealContext;
}) {
  useEffect(() => {
    // Inject deal context into window for Stitch iframe to consume
    if (typeof window !== "undefined") {
      (window as any).__BUDDY_CONTEXT__ = {
        ...context,
        role: "underwriter",
        readonly: true,
      };
    }
  }, [context]);

  return (
    <div className="h-full">
      <iframe
        src="/stitch/deal-summary"
        className="h-full w-full border-0"
        title="Deal Summary"
      />
    </div>
  );
}

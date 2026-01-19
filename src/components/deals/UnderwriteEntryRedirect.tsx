"use client";

import { useEffect } from "react";

export function UnderwriteEntryRedirect({
  dealId,
  enabled,
  delayMs = 2500,
}: {
  dealId: string;
  enabled: boolean;
  delayMs?: number;
}) {
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => {
      window.location.assign(`/deals/${dealId}/cockpit?autostart=1`);
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [dealId, enabled, delayMs]);

  return null;
}

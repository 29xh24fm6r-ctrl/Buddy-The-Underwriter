"use client";

import { useState, useEffect } from "react";
import { useCockpitStateContext } from "@/hooks/useCockpitState";
import { OmegaConfidenceBadge } from "@/components/deal/OmegaConfidenceBadge";
import type { OmegaAdvisoryState } from "@/core/omega/types";

/**
 * Cockpit header badge for Omega confidence.
 * Fetches from /api/deals/[dealId]/state (which already returns omega state).
 * Renders null gracefully when dealId is not a real UUID (Stitch preview guard).
 */
export function CockpitOmegaBadge() {
  const { state } = useCockpitStateContext();
  const [omega, setOmega] = useState<OmegaAdvisoryState | null>(null);

  const dealId = state?.deal?.id;

  useEffect(() => {
    if (!dealId) return;
    // Guard: only fetch for real UUIDs
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(dealId)) return;

    fetch(`/api/deals/${dealId}/state`)
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && json.omega) {
          setOmega(json.omega);
        }
      })
      .catch(() => {
        // Non-fatal — Omega is advisory only
      });
  }, [dealId]);

  if (!omega) return null;

  return <OmegaConfidenceBadge omega={omega} />;
}

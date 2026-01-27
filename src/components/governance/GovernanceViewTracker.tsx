"use client";

/**
 * GovernanceViewTracker
 *
 * Fires a POST to /api/governance/viewed when the governance page mounts.
 * Renders nothing — purely for audit trail.
 */

import { useEffect } from "react";

export function GovernanceViewTracker() {
  useEffect(() => {
    fetch("/api/governance/viewed", { method: "POST" }).catch(() => {});
  }, []);

  return null;
}

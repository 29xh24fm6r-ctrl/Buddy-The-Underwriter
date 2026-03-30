// Pure function. No DB. No side effects. No network.
// Human-readable operator summary for V2 operating state.

type V2State = {
  v2Enabled: boolean;
  envFlags: Record<string, string | undefined>;
  registryHealth: {
    metricCount: number;
    loaded: boolean;
    error: string | null;
  };
  snapshotHealth: {
    totalSnapshots: number;
    recentSnapshotCount: number;
    latestSnapshotAt: string | null;
  };
  diagnostics: string[];
};

export type V2SummaryLevel = "green" | "yellow" | "red";

export type V2OperatingSummary = {
  level: V2SummaryLevel;
  headline: string;
  details: string[];
};

/**
 * Format V2 operating state into a human-readable operator summary.
 * Red/yellow/green style — Buddy should explain operating state like a trusted
 * chief credit officer, not raw JSON.
 */
export function formatV2OperatingSummary(state: V2State): V2OperatingSummary {
  const details: string[] = [];

  // Registry assessment
  if (state.registryHealth.error) {
    details.push(`Registry error: ${state.registryHealth.error}`);
  } else if (!state.registryHealth.loaded) {
    details.push("Registry: empty — no metric definitions loaded");
  } else {
    details.push(`Registry: ${state.registryHealth.metricCount} metrics loaded`);
  }

  // Snapshot assessment
  if (state.snapshotHealth.totalSnapshots === 0) {
    details.push("Snapshots: none — no model snapshots have been persisted");
  } else {
    details.push(`Snapshots: ${state.snapshotHealth.totalSnapshots} total, ${state.snapshotHealth.recentSnapshotCount} in last 24h`);

    if (state.snapshotHealth.latestSnapshotAt) {
      const ageMs = Date.now() - new Date(state.snapshotHealth.latestSnapshotAt).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);
      if (ageHours < 24) {
        details.push("Latest snapshot: fresh (< 24h)");
      } else if (ageHours < 168) {
        details.push(`Latest snapshot: stale (${Math.round(ageHours / 24)}d ago)`);
      } else {
        details.push(`Latest snapshot: cold (${Math.round(ageHours / 24)}d ago)`);
      }
    }
  }

  // Shadow compare
  if (state.envFlags.SHADOW_COMPARE === "true") {
    details.push("Shadow comparison: enabled");
  } else {
    details.push("Shadow comparison: disabled");
  }

  // V2 primary
  if (state.v2Enabled) {
    details.push("V2 is primary engine");
  } else {
    details.push("V1 remains primary — V2 is secondary/shadow only");
  }

  // Determine overall level
  let level: V2SummaryLevel;
  let headline: string;

  if (state.registryHealth.error || !state.registryHealth.loaded) {
    level = "red";
    headline = "Model Engine V2: registry not healthy — check metric_definitions";
  } else if (state.snapshotHealth.totalSnapshots === 0) {
    level = "yellow";
    headline = "Model Engine V2: registry loaded but no snapshots persisted yet";
  } else if (state.snapshotHealth.recentSnapshotCount === 0) {
    level = "yellow";
    headline = "Model Engine V2: no recent snapshots — may be inactive or stalled";
  } else if (state.v2Enabled) {
    level = "green";
    headline = "Model Engine V2: primary, registry healthy, snapshots active";
  } else {
    level = "green";
    headline = "Model Engine V2: shadow mode healthy, registry loaded, snapshots active";
  }

  return { level, headline, details };
}

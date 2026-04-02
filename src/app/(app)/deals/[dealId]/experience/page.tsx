"use client";

/**
 * Banker Experience Dashboard — Phase 66B (Commit 8)
 *
 * Unified deal workspace panels:
 * - Material Changes
 * - Next Best Actions
 * - Trust Heatmap
 * - Agent Activity Timeline
 * - Monitoring Feedback
 * - Structure Opportunities
 */

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

// ============================================================================
// Types
// ============================================================================

type MaterialChange = {
  id: string;
  change_type: string;
  change_scope: string;
  materiality_score: string;
  affected_systems_json: Record<string, unknown>;
  created_at: string;
};

type ActionRec = {
  id: string;
  action_category: string;
  priority_score: number;
  urgency_score: number;
  confidence_score: string;
  rationale_json: Record<string, unknown>;
  expected_impact_json: Record<string, unknown>;
  status: string;
};

type TrustEntry = {
  conclusion_key: string;
  support_type: string;
  confidence_level: string;
  freshness_status: string;
  decision_safe: boolean;
};

type HandoffEntry = {
  id: string;
  from_agent_type: string;
  to_agent_type: string;
  handoff_type: string;
  status: string;
  created_at: string;
};

type MonitoringSignal = {
  id: string;
  signal_type: string;
  severity: string;
  direction: string;
  created_at: string;
};

type DashboardData = {
  materialChanges: MaterialChange[];
  actions: ActionRec[];
  trust: TrustEntry[];
  handoffs: HandoffEntry[];
  signals: MonitoringSignal[];
};

// ============================================================================
// Helpers
// ============================================================================

const SCOPE_COLORS: Record<string, string> = {
  trivial: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  localized: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  material: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  mission_wide: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

const SEVERITY_COLORS: Record<string, string> = {
  info: "text-gray-500",
  warning: "text-yellow-600 dark:text-yellow-400",
  alert: "text-orange-600 dark:text-orange-400",
  critical: "text-red-600 dark:text-red-400",
};

const TRUST_COLORS: Record<string, string> = {
  high: "bg-green-200 dark:bg-green-900",
  medium: "bg-blue-200 dark:bg-blue-900",
  low: "bg-yellow-200 dark:bg-yellow-900",
  insufficient: "bg-red-200 dark:bg-red-900",
};

function formatLabel(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ============================================================================
// Panel Components
// ============================================================================

function MaterialChangesPanel({ changes }: { changes: MaterialChange[] }) {
  if (changes.length === 0) return null;
  return (
    <section className="border rounded-lg p-4 dark:border-gray-700">
      <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-gray-500">Material Changes</h2>
      <div className="space-y-2">
        {changes.slice(0, 5).map((c) => (
          <div key={c.id} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${SCOPE_COLORS[c.change_scope] ?? ""}`}>
                {c.change_scope}
              </span>
              <span>{formatLabel(c.change_type)}</span>
            </div>
            <span className="text-xs text-gray-400">
              {new Date(c.created_at).toLocaleDateString()}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function NextActionsPanel({ actions }: { actions: ActionRec[] }) {
  const open = actions.filter((a) => a.status === "open").slice(0, 5);
  if (open.length === 0) return null;
  return (
    <section className="border rounded-lg p-4 dark:border-gray-700">
      <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-gray-500">Next Best Actions</h2>
      <div className="space-y-2">
        {open.map((a) => (
          <div key={a.id} className="p-3 bg-gray-50 dark:bg-gray-800 rounded">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{formatLabel(a.action_category)}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">P{a.priority_score}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  a.confidence_score === "high" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                  a.confidence_score === "medium" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" :
                  "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
                }`}>{a.confidence_score}</span>
              </div>
            </div>
            {a.rationale_json && typeof a.rationale_json === "object" && "description" in a.rationale_json && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {String(a.rationale_json.description)}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function TrustHeatmap({ entries }: { entries: TrustEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="border rounded-lg p-4 dark:border-gray-700">
      <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-gray-500">Trust Heatmap</h2>
      <div className="grid grid-cols-2 gap-1.5">
        {entries.slice(0, 8).map((t) => (
          <div
            key={t.conclusion_key}
            className={`p-2 rounded text-xs ${TRUST_COLORS[t.confidence_level] ?? "bg-gray-100"}`}
          >
            <div className="font-medium truncate">{formatLabel(t.conclusion_key)}</div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="opacity-70">{t.support_type}</span>
              {t.decision_safe && <span className="text-green-700 dark:text-green-400 font-semibold">Safe</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AgentActivityPanel({ handoffs }: { handoffs: HandoffEntry[] }) {
  if (handoffs.length === 0) return null;
  return (
    <section className="border rounded-lg p-4 dark:border-gray-700">
      <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-gray-500">Agent Activity</h2>
      <div className="space-y-2">
        {handoffs.slice(0, 5).map((h) => (
          <div key={h.id} className="flex items-center justify-between text-xs">
            <span>
              <span className="font-medium">{formatLabel(h.from_agent_type)}</span>
              {" → "}
              <span className="font-medium">{formatLabel(h.to_agent_type)}</span>
            </span>
            <span className={`px-1.5 py-0.5 rounded ${
              h.status === "complete" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
              h.status === "pending" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-600"
            }`}>{h.status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function MonitoringPanel({ signals }: { signals: MonitoringSignal[] }) {
  if (signals.length === 0) return null;
  return (
    <section className="border rounded-lg p-4 dark:border-gray-700">
      <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-gray-500">Monitoring Signals</h2>
      <div className="space-y-2">
        {signals.slice(0, 5).map((s) => (
          <div key={s.id} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className={SEVERITY_COLORS[s.severity] ?? ""}>
                {s.severity === "critical" ? "!!" : s.severity === "alert" ? "!" : ""}
              </span>
              <span>{formatLabel(s.signal_type)}</span>
            </div>
            <span className="text-xs text-gray-400">
              {s.direction === "deteriorating" ? "↓" : s.direction === "improving" ? "↑" : "→"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function BankerExperiencePage() {
  const params = useParams();
  const dealId = params.dealId as string;

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/deals/${dealId}/experience`);
      if (res.ok) {
        setData(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="p-6 animate-pulse space-y-4">
        <div className="h-6 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  if (!data) {
    return <div className="p-6 text-gray-500">No experience data available yet.</div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <h1 className="text-xl font-bold">Deal Intelligence</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <NextActionsPanel actions={data.actions} />
        <TrustHeatmap entries={data.trust} />
        <MaterialChangesPanel changes={data.materialChanges} />
        <MonitoringPanel signals={data.signals} />
        <AgentActivityPanel handoffs={data.handoffs} />
      </div>
    </div>
  );
}

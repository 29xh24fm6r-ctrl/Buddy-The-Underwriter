/**
 * Observer Panel — Builder-only ops console for omega diagnostics.
 *
 * Tabs:
 *   Health    — omega status, latency, kill switch
 *   Degraded  — degraded endpoint tracker + omega failures
 *   Mirrors   — last mirrored events + ack status
 *   Traces    — input correlation → trace viewer
 *   Tools     — replay + validate (builder-only)
 *
 * Client-side component. Data fetched via useObserverFeed.
 */
"use client";

import React, { useState } from "react";
import { useObserverFeed, type OmegaEventEntry } from "./useObserverFeed";
import { ObserverBadges } from "./ObserverBadges";
import { useAegisHealth } from "@/buddy/hooks/useAegisHealth";
import type { AegisFinding } from "@/buddy/hooks/useAegisHealth";

// ── Tab Types ─────────────────────────────────────

type TabId = "health" | "degraded" | "mirrors" | "traces" | "tools" | "aegis";

const TABS: { id: TabId; label: string }[] = [
  { id: "health", label: "Health" },
  { id: "degraded", label: "Degraded" },
  { id: "mirrors", label: "Mirrors" },
  { id: "traces", label: "Traces" },
  { id: "tools", label: "Tools" },
  { id: "aegis", label: "Aegis" },
];

// ── Panel Component ───────────────────────────────

export function ObserverPanel() {
  const [activeTab, setActiveTab] = useState<TabId>("health");
  const feed = useObserverFeed({ pollIntervalMs: 15_000 });
  const aegis = useAegisHealth({ dealId: null, enabled: true, pollIntervalMs: 30_000 });

  return (
    <div className="border border-gray-200 rounded-lg bg-white shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-900">Observer</h3>
          <ObserverBadges health={feed.health} degraded={feed.degraded} />
        </div>
        <button
          onClick={feed.refresh}
          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded border border-gray-200"
        >
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-100 flex gap-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="p-4 text-sm">
        {feed.loading && !feed.health && (
          <div className="text-gray-400 text-xs">Loading observer data...</div>
        )}

        {feed.error && (
          <div className="text-red-600 text-xs mb-2">Error: {feed.error}</div>
        )}

        {activeTab === "health" && feed.health && <HealthTab health={feed.health} />}
        {activeTab === "degraded" && <DegradedTab degraded={feed.degraded} />}
        {activeTab === "mirrors" && <MirrorsTab events={feed.events} />}
        {activeTab === "traces" && <TracesTab />}
        {activeTab === "tools" && <ToolsTab />}
        {activeTab === "aegis" && <AegisTab aegis={aegis} />}
      </div>

      {/* Footer */}
      {feed.lastRefresh && (
        <div className="px-4 py-2 border-t border-gray-100 text-[10px] text-gray-400">
          Last refresh: {new Date(feed.lastRefresh).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

// ── Tab Panels ────────────────────────────────────

function HealthTab({ health }: { health: NonNullable<ReturnType<typeof useObserverFeed>["health"]> }) {
  return (
    <div className="space-y-2">
      <Row label="Available" value={health.available ? "Yes" : "No"} />
      <Row label="Enabled" value={health.enabled ? "Yes" : "No"} />
      <Row label="Kill Switch" value={health.killed ? "ACTIVE" : "Off"} />
      <Row label="Latency" value={health.latencyMs !== null ? `${health.latencyMs}ms` : "N/A"} />
      <Row label="Error" value={health.error ?? "None"} />
      <Row label="Checked" value={health.checkedAt} />
    </div>
  );
}

function DegradedTab({ degraded }: { degraded: ReturnType<typeof useObserverFeed>["degraded"] }) {
  if (!degraded || degraded.count === 0) {
    return <div className="text-gray-400 text-xs">No degraded events.</div>;
  }
  return (
    <div className="space-y-1">
      <div className="text-xs text-gray-500 mb-2">{degraded.count} recent degraded event(s)</div>
      {degraded.recent.slice(0, 10).map((evt, i) => (
        <div key={i} className="text-[11px] font-mono text-gray-600 bg-gray-50 px-2 py-1 rounded">
          {JSON.stringify(evt, null, 0).slice(0, 200)}
        </div>
      ))}
    </div>
  );
}

function MirrorsTab({ events }: { events: OmegaEventEntry[] }) {
  if (events.length === 0) {
    return <div className="text-gray-400 text-xs">No omega events recorded.</div>;
  }
  return (
    <div className="space-y-1 max-h-64 overflow-y-auto">
      {events.slice(0, 20).map((evt) => (
        <div key={evt.id} className="text-[11px] font-mono bg-gray-50 px-2 py-1 rounded flex gap-2">
          <span className="text-gray-400 shrink-0">{new Date(evt.created_at).toLocaleTimeString()}</span>
          <span className="text-blue-600 shrink-0">{evt.type}</span>
          <span className="text-gray-500 truncate">{evt.source}</span>
        </div>
      ))}
    </div>
  );
}

function TracesTab() {
  const [sessionId, setSessionId] = useState("");
  const [traces, setTraces] = useState<unknown[] | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchTraces = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/buddy/observer/traces?session_id=${encodeURIComponent(sessionId)}`);
      const data = await res.json();
      setTraces(data.ok ? data.traces : []);
    } catch {
      setTraces([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Session ID or Correlation ID"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          className="flex-1 text-xs border border-gray-200 rounded px-2 py-1"
        />
        <button
          onClick={fetchTraces}
          disabled={loading || !sessionId}
          className="text-xs px-3 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? "..." : "Fetch"}
        </button>
      </div>
      {traces !== null && (
        <div className="max-h-48 overflow-y-auto">
          {traces.length === 0 ? (
            <div className="text-gray-400 text-xs">No traces found.</div>
          ) : (
            traces.map((t, i) => (
              <div key={i} className="text-[11px] font-mono bg-gray-50 px-2 py-1 rounded mb-1">
                {JSON.stringify(t, null, 0).slice(0, 300)}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ToolsTab() {
  const [caseId, setCaseId] = useState("");
  const [toolResult, setToolResult] = useState<unknown>(null);
  const [toolLoading, setToolLoading] = useState(false);

  const runTool = async (toolPath: string) => {
    if (!caseId) return;
    setToolLoading(true);
    try {
      const res = await fetch(toolPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId }),
      });
      const data = await res.json();
      setToolResult(data);
    } catch (err) {
      setToolResult({ ok: false, error: String(err) });
    } finally {
      setToolLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Case ID (deal UUID)"
          value={caseId}
          onChange={(e) => setCaseId(e.target.value)}
          className="flex-1 text-xs border border-gray-200 rounded px-2 py-1"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => runTool("/api/copilot/validate")}
          disabled={toolLoading || !caseId}
          className="text-xs px-3 py-1 rounded bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Validate
        </button>
        <button
          onClick={() => runTool("/api/copilot/draft-missing-docs-email")}
          disabled={toolLoading || !caseId}
          className="text-xs px-3 py-1 rounded bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Draft Email
        </button>
      </div>
      {toolResult !== null && (
        <pre className="text-[10px] font-mono bg-gray-50 p-2 rounded max-h-48 overflow-y-auto">
          {JSON.stringify(toolResult, null, 2)}
        </pre>
      )}
    </div>
  );
}

function AegisTab({ aegis }: { aegis: ReturnType<typeof useAegisHealth> }) {
  const SEVERITY_BADGE: Record<string, string> = {
    ok: "bg-green-100 text-green-700",
    degraded: "bg-amber-100 text-amber-700",
    alert: "bg-red-100 text-red-700",
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500">Severity:</span>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            SEVERITY_BADGE[aegis.severity ?? "ok"] ?? "bg-gray-100 text-gray-600"
          }`}
        >
          {aegis.severity ?? "unknown"}
        </span>
        {aegis.stale && (
          <span className="text-[10px] text-gray-400 italic">stale</span>
        )}
      </div>

      {aegis.counts && (
        <div className="space-y-1">
          <Row label="Critical" value={String(aegis.counts.critical ?? 0)} />
          <Row label="Error" value={String(aegis.counts.error ?? 0)} />
          <Row label="Warning" value={String(aegis.counts.warning ?? 0)} />
          <Row label="Suppressed" value={String(aegis.counts.suppressed ?? 0)} />
        </div>
      )}

      <div className="text-xs font-medium text-gray-700 mt-2">
        Open Findings ({aegis.findings.length})
      </div>

      {aegis.findings.length === 0 ? (
        <div className="text-gray-400 text-xs">No open findings.</div>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {aegis.findings.slice(0, 25).map((f: AegisFinding) => (
            <div
              key={f.id}
              className={`text-[11px] font-mono px-2 py-1.5 rounded border ${
                f.severity === "critical"
                  ? "bg-red-50 border-red-200"
                  : f.severity === "error"
                    ? "bg-red-50/50 border-red-100"
                    : "bg-amber-50/50 border-amber-100"
              }`}
            >
              <div className="flex items-center gap-2">
                {f.errorClass && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                    {f.errorClass}
                  </span>
                )}
                <span className="text-gray-500">{f.sourceSystem}</span>
                <span className="ml-auto text-gray-400">{f.resolutionStatus}</span>
              </div>
              <div className="text-gray-700 mt-0.5 truncate">
                {f.errorMessage ?? `${f.eventType} event`}
              </div>
            </div>
          ))}
        </div>
      )}

      {aegis.lastRefresh && (
        <div className="text-[10px] text-gray-400">
          Last checked: {new Date(aegis.lastRefresh).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-mono">{value}</span>
    </div>
  );
}

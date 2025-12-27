"use client";

import React, { useState, useEffect } from "react";

/**
 * SBA God Mode: Autopilot Console
 * 
 * The "Make E-Tran Ready" button UI.
 * Shows live pipeline progress, punchlist, and readiness meter.
 */

interface AutopilotConsoleProps {
  dealId: string;
  bankId: string;
}

interface AutopilotStatus {
  pipeline: {
    run_id: string;
    status: "queued" | "running" | "succeeded" | "failed" | "canceled";
    current_stage: string;
    progress: number;
    stage_logs: Array<{
      stage: string;
      status: string;
      message: string;
      timestamp: string;
    }>;
    started_at?: string;
    finished_at?: string;
    error?: any;
  } | null;
  truth: {
    snapshot_id: string;
    version: number;
    overall_confidence: number;
    needs_human: number;
  } | null;
  conflicts: {
    open_count: number;
  };
  readiness: {
    overall_score: number;
    label: string;
    blockers: string[];
    gates_applied: Array<{ condition: string; cap: number }>;
  };
  punchlist: {
    borrower_actions: any[];
    banker_actions: any[];
    system_reviews: any[];
    total_count: number;
    blocking_count: number;
  };
}

export function AutopilotConsole({ dealId, bankId }: AutopilotConsoleProps) {
  const [status, setStatus] = useState<AutopilotStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/autopilot/status`);
      const data = await res.json();
      if (data.ok) {
        setStatus(data.data);
        setRunning(data.data.pipeline?.status === "running");
      }
    } catch (err) {
      console.error("Failed to load autopilot status:", err);
    }
  };

  const startAutopilot = async () => {
    setError(null);
    setRunning(true);
    setConsoleOpen(true);

    try {
      const res = await fetch(`/api/deals/${dealId}/autopilot/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "full", force: false }),
      });

      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Failed to start autopilot");
        setRunning(false);
        return;
      }

      // Poll for updates
      const pollInterval = setInterval(async () => {
        await loadStatus();
        if (status?.pipeline?.status && !["running", "queued"].includes(status.pipeline.status)) {
          clearInterval(pollInterval);
          setRunning(false);
        }
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setRunning(false);
    }
  };

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, [dealId]);

  const readinessPercent = status ? Math.round(status.readiness.overall_score * 100) : 0;
  const isComplete = readinessPercent >= 100;

  return (
    <div className="space-y-4">
      {/* Primary CTA Button */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold mb-2">E-Tran Ready Autopilot</h2>
            <p className="text-sm text-gray-600 mb-4">
              Run the full SBA underwriting pipeline to make this deal submission-ready
            </p>
          </div>
          
          <button
            onClick={startAutopilot}
            disabled={running}
            className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
              running
                ? "bg-gray-400 cursor-not-allowed text-white"
                : isComplete
                ? "bg-green-600 hover:bg-green-700 text-white"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {running ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Running...
              </span>
            ) : isComplete ? (
              "✓ E-Tran Ready"
            ) : (
              "▶ Make E-Tran Ready"
            )}
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* Readiness Meter */}
      {status && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Readiness Status</h3>
            <button
              onClick={() => setConsoleOpen(!consoleOpen)}
              className="text-sm text-blue-600 hover:underline"
            >
              {consoleOpen ? "Hide Details" : "Show Details"}
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-2xl font-bold">{readinessPercent}%</span>
                  <span className="text-sm text-gray-600">{status.readiness.label}</span>
                </div>
                <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      readinessPercent >= 100
                        ? "bg-green-500"
                        : readinessPercent >= 75
                        ? "bg-yellow-500"
                        : "bg-blue-500"
                    }`}
                    style={{ width: `${readinessPercent}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Blockers */}
            {status.readiness.blockers.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded p-3">
                <p className="text-sm font-medium text-red-900 mb-1">Blockers</p>
                <ul className="text-sm text-red-700 space-y-1">
                  {status.readiness.blockers.map((blocker, idx) => (
                    <li key={idx}>• {blocker}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Gates Applied */}
            {status.readiness.gates_applied.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
                <p className="text-sm font-medium text-yellow-900 mb-1">Score Caps Applied</p>
                <ul className="text-sm text-yellow-700 space-y-1">
                  {status.readiness.gates_applied.map((gate, idx) => (
                    <li key={idx}>
                      • {gate.condition} (capped at {Math.round(gate.cap * 100)}%)
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Live Console (collapsible) */}
      {consoleOpen && status?.pipeline && (
        <div className="bg-gray-900 text-white rounded-lg p-6">
          <h3 className="font-semibold mb-4">Pipeline Execution Log</h3>
          
          <div className="space-y-2 font-mono text-xs">
            {status.pipeline.stage_logs.map((log, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-2 ${
                  log.status === "succeeded"
                    ? "text-green-400"
                    : log.status === "failed"
                    ? "text-red-400"
                    : log.status === "started"
                    ? "text-yellow-400"
                    : "text-gray-400"
                }`}
              >
                <span className="opacity-50">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span>
                  {log.status === "succeeded" && "✓"}
                  {log.status === "failed" && "✗"}
                  {log.status === "started" && "▶"}
                </span>
                <span>{log.stage}</span>
                <span className="opacity-75">→ {log.message}</span>
              </div>
            ))}
          </div>

          {status.pipeline.status === "running" && (
            <div className="mt-4 flex items-center gap-2 text-sm text-gray-400">
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Stage {status.pipeline.current_stage} in progress...</span>
            </div>
          )}
        </div>
      )}

      {/* Punchlist */}
      {status && status.punchlist.total_count > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="font-semibold mb-4">
            Punchlist ({status.punchlist.total_count} items)
            {status.punchlist.blocking_count > 0 && (
              <span className="ml-2 text-sm text-red-600">
                {status.punchlist.blocking_count} blocking
              </span>
            )}
          </h3>

          {/* Borrower Actions */}
          {status.punchlist.borrower_actions.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Borrower Actions</h4>
              <div className="space-y-2">
                {status.punchlist.borrower_actions.map((item) => (
                  <PunchlistItemCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}

          {/* Banker Actions */}
          {status.punchlist.banker_actions.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Banker Actions</h4>
              <div className="space-y-2">
                {status.punchlist.banker_actions.map((item) => (
                  <PunchlistItemCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}

          {/* System Reviews */}
          {status.punchlist.system_reviews.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">System Reviews</h4>
              <div className="space-y-2">
                {status.punchlist.system_reviews.map((item) => (
                  <PunchlistItemCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PunchlistItemCard({ item }: { item: any }) {
  const priorityColors = {
    critical: "border-red-300 bg-red-50",
    high: "border-orange-300 bg-orange-50",
    medium: "border-blue-300 bg-blue-50",
    low: "border-gray-300 bg-gray-50",
  };

  return (
    <div className={`border rounded p-3 ${priorityColors[item.priority as keyof typeof priorityColors]}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h5 className="font-medium text-sm">{item.title}</h5>
            {item.blocking && (
              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">
                Blocking
              </span>
            )}
            <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
              {item.sba_vs_bank === "sba" ? "SBA Rule" : item.sba_vs_bank === "bank" ? "Bank Policy" : "Both"}
            </span>
          </div>
          <p className="text-sm text-gray-700">{item.description}</p>
          <p className="text-xs text-gray-500 mt-1">Reason: {item.reason}</p>
        </div>
        
        {item.link && (
          <a
            href={item.link}
            className="text-sm text-blue-600 hover:underline ml-4"
          >
            Fix →
          </a>
        )}
      </div>
    </div>
  );
}

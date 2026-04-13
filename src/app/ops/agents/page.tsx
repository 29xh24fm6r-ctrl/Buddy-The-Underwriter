"use client";

import { useEffect, useState, useCallback } from "react";
import {
  GlassShell,
  GlassPageHeader,
  GlassPanel,
} from "@/components/layout/GlassShell";
import {
  WORKFLOW_REGISTRY,
  getAllWorkflowCodes,
} from "@/lib/agentWorkflows/registry";
import type { AgentWorkflowRun } from "@/lib/agentWorkflows/types";

// ── Status badge colors ─────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  // Success
  complete: "bg-emerald-500/20 text-emerald-300",
  succeeded: "bg-emerald-500/20 text-emerald-300",
  CLEAN: "bg-emerald-500/20 text-emerald-300",
  completed: "bg-emerald-500/20 text-emerald-300",
  approved: "bg-emerald-500/20 text-emerald-300",
  sent: "bg-blue-500/20 text-blue-300",
  // Running
  running: "bg-amber-500/20 text-amber-300",
  queued: "bg-amber-500/20 text-amber-300",
  in_progress: "bg-amber-500/20 text-amber-300",
  draft: "bg-slate-500/20 text-slate-300",
  pending_approval: "bg-amber-500/20 text-amber-300",
  // Fail
  failed: "bg-red-500/20 text-red-300",
  cancelled: "bg-red-500/20 text-red-300",
  rejected: "bg-red-500/20 text-red-300",
  CONFLICTS: "bg-red-500/20 text-red-300",
  // Other
  FLAGS: "bg-yellow-500/20 text-yellow-300",
  routed_to_review: "bg-yellow-500/20 text-yellow-300",
  created: "bg-slate-500/20 text-slate-300",
  already_exists: "bg-slate-500/20 text-slate-300",
  noop: "bg-slate-500/20 text-slate-300",
  expired: "bg-slate-500/20 text-slate-300",
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "bg-slate-500/20 text-slate-300";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {status}
    </span>
  );
}

// ── Main page ───────────────────────────────────────────────────────

export default function OpsAgentRunsPage() {
  const [runs, setRuns] = useState<AgentWorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [workflowFilter, setWorkflowFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dealFilter, setDealFilter] = useState("");

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (workflowFilter) params.set("workflow_code", workflowFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (dealFilter) params.set("deal_id", dealFilter);
      params.set("limit", "100");

      const res = await fetch(`/api/ops/agent-runs?${params.toString()}`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setRuns(data.runs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [workflowFilter, statusFilter, dealFilter]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const workflowCodes = getAllWorkflowCodes();

  return (
    <GlassShell>
      <GlassPageHeader
        title="Agent Workflow Runs"
        subtitle="Unified view across all agent workflow executions"
        actions={
          <button
            onClick={fetchRuns}
            disabled={loading}
            className="rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 hover:bg-white/10 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        }
      />

      {/* Filters */}
      <GlassPanel header="Filters" className="mb-4">
        <div className="flex flex-wrap gap-3">
          <select
            value={workflowFilter}
            onChange={(e) => setWorkflowFilter(e.target.value)}
            className="rounded-lg border border-white/20 bg-[#0f172a] px-3 py-1.5 text-sm text-white/80"
          >
            <option value="">All workflows</option>
            {workflowCodes.map((code) => (
              <option key={code} value={code}>
                {WORKFLOW_REGISTRY[code].label}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Filter by status..."
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-white/20 bg-[#0f172a] px-3 py-1.5 text-sm text-white/80 placeholder-white/30"
          />

          <input
            type="text"
            placeholder="Filter by deal ID..."
            value={dealFilter}
            onChange={(e) => setDealFilter(e.target.value)}
            className="rounded-lg border border-white/20 bg-[#0f172a] px-3 py-1.5 text-sm text-white/80 placeholder-white/30"
          />
        </div>
      </GlassPanel>

      {/* Error state */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Results table */}
      <GlassPanel header={`Runs (${runs.length})`} noPadding>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-white/50">
                <th className="px-4 py-3">Workflow</th>
                <th className="px-4 py-3">Deal</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Cost (USD)</th>
                <th className="px-4 py-3 text-right">Tokens (in/out)</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-white/40"
                  >
                    No workflow runs found
                  </td>
                </tr>
              )}
              {loading && runs.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-white/40"
                  >
                    Loading...
                  </td>
                </tr>
              )}
              {runs.map((run) => (
                <tr
                  key={`${run.workflow_code}-${run.id}`}
                  className="border-b border-white/5 hover:bg-white/[0.02]"
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-white/80">
                      {WORKFLOW_REGISTRY[
                        run.workflow_code as keyof typeof WORKFLOW_REGISTRY
                      ]?.label ?? run.workflow_code}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`/deals/${run.deal_id}`}
                      className="font-mono text-xs text-blue-400 hover:underline"
                    >
                      {run.deal_id.slice(0, 8)}...
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-white/60">
                    {run.cost_usd != null
                      ? `$${Number(run.cost_usd).toFixed(4)}`
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-white/60">
                    {run.input_tokens != null || run.output_tokens != null
                      ? `${run.input_tokens ?? 0} / ${run.output_tokens ?? 0}`
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-xs text-white/50">
                    {new Date(run.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassPanel>
    </GlassShell>
  );
}

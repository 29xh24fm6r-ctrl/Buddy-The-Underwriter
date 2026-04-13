"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  GlassShell,
  GlassPageHeader,
  GlassPanel,
} from "@/components/layout/GlassShell";
import Link from "next/link";

export default function AgentRunDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const runId = (params as any)?.runId as string;
  const workflowCode = searchParams?.get("workflow_code") ?? "";

  const [run, setRun] = useState<Record<string, unknown> | null>(null);
  const [workflow, setWorkflow] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId || !workflowCode) return;
    setLoading(true);
    fetch(`/api/ops/agent-runs/${runId}?workflow_code=${encodeURIComponent(workflowCode)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setRun(data.run);
          setWorkflow(data.workflow);
        } else {
          setError(data.error ?? "Unknown error");
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [runId, workflowCode]);

  return (
    <GlassShell>
      <GlassPageHeader
        title={workflow ? String(workflow.label) : workflowCode}
        subtitle={`Run ${runId.slice(0, 8)}...`}
        actions={
          <Link
            href="/ops/agents"
            className="rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 hover:bg-white/10"
          >
            Back to Runs
          </Link>
        }
      />

      {loading && (
        <div className="text-center py-12 text-white/40">Loading...</div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {run && (
        <GlassPanel header="Run Details">
          <div className="space-y-3">
            {Object.entries(run).map(([key, value]) => (
              <div key={key} className="flex gap-4 border-b border-white/5 pb-2">
                <span className="w-48 shrink-0 text-xs font-bold uppercase tracking-wider text-white/50">
                  {key}
                </span>
                <span className="text-sm text-white/80 break-all">
                  {value === null
                    ? <span className="text-white/30 italic">null</span>
                    : typeof value === "object"
                      ? <pre className="text-xs whitespace-pre-wrap font-mono">{JSON.stringify(value, null, 2)}</pre>
                      : String(value)}
                </span>
              </div>
            ))}
          </div>
        </GlassPanel>
      )}
    </GlassShell>
  );
}

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type PolicyException = {
  key?: string;
  rule_key?: string;
  severity?: string;
  message?: string;
  description?: string;
};

type PreviewResult = {
  ok: boolean;
  preview?: boolean;
  disclaimer?: string;
  policy?: {
    exceptions: PolicyException[];
    complianceScore: number;
    suggestedMitigants: Array<{
      key: string;
      label: string;
      priority: number;
      reason_rule_keys: string[];
    }>;
  };
  error?: { code: string; message: string };
  meta?: { correlationId?: string };
};

export function PreviewUnderwritePanel({ dealId }: { dealId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<PreviewResult | null>(null);

  async function handlePreview() {
    setStatus("loading");
    setResult(null);

    try {
      const res = await fetch(`/api/deals/${dealId}/underwrite/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data: PreviewResult = await res.json();
      setResult(data);
      setStatus(data.ok ? "done" : "error");
    } catch {
      setStatus("error");
      setResult({ ok: false, error: { code: "network_error", message: "Network error" } });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-widest text-white/50">
          Preview Underwrite
        </span>
        <button
          onClick={handlePreview}
          disabled={status === "loading"}
          className={cn(
            "rounded-lg px-4 py-1.5 text-xs font-semibold transition-all",
            status === "loading"
              ? "bg-white/5 text-white/20 cursor-not-allowed"
              : "bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 border border-blue-500/30"
          )}
        >
          {status === "loading" ? "Running..." : "Run Preview"}
        </button>
      </div>

      <p className="text-[11px] text-white/30">
        Runs the policy engine without advancing lifecycle. Shows preliminary risk signals even with incomplete documents.
      </p>

      {result?.ok && result.policy && (
        <div className="space-y-3">
          {/* Disclaimer banner */}
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            {result.disclaimer}
          </div>

          {/* Compliance score */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/50">Compliance Score</span>
            <span
              className={cn(
                "font-mono text-sm font-bold",
                result.policy.complianceScore >= 80
                  ? "text-emerald-400"
                  : result.policy.complianceScore >= 50
                  ? "text-amber-400"
                  : "text-red-400"
              )}
            >
              {result.policy.complianceScore}
            </span>
          </div>

          {/* Exceptions */}
          {result.policy.exceptions.length > 0 && (
            <div className="space-y-1">
              <span className="text-[11px] text-white/40 font-semibold uppercase tracking-wider">
                Exceptions ({result.policy.exceptions.length})
              </span>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {result.policy.exceptions.map((ex, i) => (
                  <div
                    key={i}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs",
                      ex.severity === "critical"
                        ? "border-red-500/30 bg-red-500/5 text-red-300"
                        : ex.severity === "warning"
                        ? "border-amber-500/30 bg-amber-500/5 text-amber-300"
                        : "border-white/10 bg-white/[0.02] text-white/60"
                    )}
                  >
                    <span className="font-mono text-[10px] text-white/30 mr-2">
                      {ex.rule_key || ex.key || `E${i + 1}`}
                    </span>
                    {ex.message || ex.description || "Policy exception"}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mitigants */}
          {result.policy.suggestedMitigants.length > 0 && (
            <div className="space-y-1">
              <span className="text-[11px] text-white/40 font-semibold uppercase tracking-wider">
                Suggested Mitigants ({result.policy.suggestedMitigants.length})
              </span>
              <div className="space-y-1">
                {result.policy.suggestedMitigants.slice(0, 5).map((m) => (
                  <div
                    key={m.key}
                    className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs text-blue-300"
                  >
                    {m.label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.policy.exceptions.length === 0 && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              No policy exceptions detected (preview)
            </div>
          )}
        </div>
      )}

      {result && !result.ok && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {result.error?.message || "Preview failed"}
          {result.meta?.correlationId && (
            <span className="ml-2 font-mono text-[10px] text-red-400/50">
              {result.meta.correlationId}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

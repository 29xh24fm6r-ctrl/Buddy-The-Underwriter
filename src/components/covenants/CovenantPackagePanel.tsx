"use client";

/**
 * Phase 55 — Covenant Package Panel
 */

import { useCallback, useEffect, useState } from "react";

type CovenantItem = {
  id: string;
  name: string;
  threshold?: number;
  draftLanguage: string;
  source: string;
  severity?: string;
  rationale?: string;
};

type Props = { dealId: string };

const SOURCE_BADGE: Record<string, string> = {
  rule_engine: "bg-blue-500/20 text-blue-400",
  ai_recommended: "bg-purple-500/20 text-purple-400",
  banker_override: "bg-amber-500/20 text-amber-400",
};

export default function CovenantPackagePanel({ dealId }: Props) {
  const [pkg, setPkg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchLatest = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/covenants/latest`);
      const json = await res.json();
      if (json.ok) setPkg(json.package);
    } catch {}
    finally { setLoading(false); }
  }, [dealId]);

  useEffect(() => { fetchLatest(); }, [fetchLatest]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      await fetch(`/api/deals/${dealId}/covenants/generate`, { method: "POST" });
      await fetchLatest();
    } finally { setGenerating(false); }
  }

  if (loading) return <div className="text-center text-white/40 py-8 text-sm">Loading covenants...</div>;

  if (!pkg) {
    return (
      <div className="glass-card rounded-xl p-6 text-center space-y-3">
        <p className="text-white/40 text-sm">No covenant package generated yet.</p>
        <button onClick={handleGenerate} disabled={generating}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50">
          {generating ? "Generating..." : "Generate Covenant Package"}
        </button>
      </div>
    );
  }

  const sections = [
    { title: "Financial Covenants", items: pkg.financial_covenants ?? [] },
    { title: "Reporting Covenants", items: pkg.reporting_covenants ?? [] },
    { title: "Behavioral Covenants", items: pkg.behavioral_covenants ?? [] },
    { title: "Springing Covenants", items: pkg.springing_covenants ?? [] },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="glass-card rounded-xl p-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white/90">Covenant Package</h3>
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-white/5 border border-white/10 text-white/50">
              {pkg.status}
            </span>
            {pkg.risk_grade && (
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/20 text-amber-400">
                {pkg.risk_grade}
              </span>
            )}
          </div>
          <p className="text-xs text-white/40 mt-1">
            v{pkg.rule_engine_version} — {new Date(pkg.generated_at).toLocaleString()}
          </p>
        </div>
        <button onClick={handleGenerate} disabled={generating}
          className="px-3 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 disabled:opacity-50">
          Re-generate
        </button>
      </div>

      {/* Rationale */}
      {pkg.rationale && (
        <div className="glass-card rounded-xl p-4">
          <p className="text-[10px] text-white/40 uppercase mb-1">Rationale</p>
          <p className="text-xs text-white/70">{pkg.rationale}</p>
        </div>
      )}

      {/* Sections */}
      {sections.map((section) => (
        <details key={section.title} open className="glass-card rounded-xl overflow-hidden">
          <summary className="px-4 py-3 text-xs font-semibold text-white/70 uppercase cursor-pointer hover:bg-white/[0.02]">
            {section.title} ({section.items.length})
          </summary>
          <div className="divide-y divide-white/5">
            {section.items.map((item: CovenantItem) => (
              <div key={item.id} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-white/80">{item.name}</span>
                  <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${SOURCE_BADGE[item.source] ?? "bg-white/5 text-white/40"}`}>
                    {item.source.replace(/_/g, " ")}
                  </span>
                  {item.severity && (
                    <span className="text-[9px] text-white/30 capitalize">{item.severity}</span>
                  )}
                </div>
                <p className="text-[11px] text-white/50 leading-relaxed">{item.draftLanguage}</p>
                {item.rationale && (
                  <p className="text-[10px] text-white/30 mt-1 italic">{item.rationale}</p>
                )}
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

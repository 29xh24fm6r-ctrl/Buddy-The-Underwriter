"use client";

// src/app/banker/dashboard/page.tsx

import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";

type Kpis = any;

function money(n: number) {
  if (!Number.isFinite(n)) return "$0";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function pct(n: number) {
  const x = Number.isFinite(n) ? n : 0;
  return `${x.toFixed(0)}%`;
}

function glowClass() {
  return "shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_0_40px_rgba(56,189,248,0.12)]";
}

export default function BankerDashboardPage() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Filters (user pipeline)
  const [userId, setUserId] = useState<string>(""); // optional if you wire to user list
  const [dealType, setDealType] = useState<string>("");
  const [stage, setStage] = useState<string>("");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/dashboard/overview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filters: {
            userId: userId || undefined,
            dealType: dealType || undefined,
            stage: stage || undefined,
          },
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load dashboard");
      setKpis(data.kpis);
    } catch (e: any) {
      setErr(e?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stageData = useMemo(() => {
    const byStage = kpis?.byStage || {};
    return Object.keys(byStage).map((k) => ({ name: k, count: byStage[k].count, amount: byStage[k].amount }));
  }, [kpis]);

  const typeData = useMemo(() => {
    const byType = kpis?.byType || {};
    return Object.keys(byType).map((k) => ({ name: k, count: byType[k].count, amount: byType[k].amount }));
  }, [kpis]);

  const scored = useMemo(() => (kpis?.scoredOpenDeals || []).slice(0, 20), [kpis]);

  const bottlenecks = useMemo(() => (kpis?.bottlenecks || []).slice(0, 10), [kpis]);
  const actions = useMemo(() => (kpis?.nextBestActions || []).slice(0, 8), [kpis]);

  return (
    <div
      className="min-h-screen bg-black text-white overflow-hidden"
      data-testid="banker-dashboard"
    >
      {/* Alive background */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full bg-sky-500/15 blur-[90px]" />
        <div className="absolute top-1/3 -right-40 h-[620px] w-[620px] rounded-full bg-fuchsia-500/12 blur-[110px]" />
        <div className="absolute bottom-0 left-1/3 h-[520px] w-[520px] rounded-full bg-emerald-500/10 blur-[110px]" />
        <motion.div
          className="absolute inset-0 opacity-30"
          animate={{ opacity: [0.18, 0.30, 0.18] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          style={{
            background:
              "radial-gradient(1200px 700px at 20% 10%, rgba(56,189,248,0.10), transparent 60%), radial-gradient(900px 600px at 80% 40%, rgba(217,70,239,0.08), transparent 55%), radial-gradient(900px 700px at 50% 90%, rgba(16,185,129,0.06), transparent 60%)",
          }}
        />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:48px_48px] opacity-[0.10]" />
      </div>

      {/* Top Command Bar */}
      <div className="sticky top-0 z-30 border-b border-white/10 bg-black/55 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center ${glowClass()}`}>
              <span className="text-sm font-semibold">P</span>
            </div>
            <div>
              <div className="text-xs text-white/60">Master Control Panel</div>
              <div className="text-lg font-semibold">Banker Dashboard</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="px-3 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 transition text-sm"
              onClick={load}
              disabled={loading}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button
              className="px-3 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 transition text-sm"
              onClick={async () => {
                await fetch("/api/dashboard/predictions/refresh", { method: "POST" });
                await load();
              }}
            >
              Recompute Predictions
            </button>
          </div>
        </div>
      </div>

      <div className="relative mx-auto max-w-7xl px-4 py-6">
        {err && (
          <div className="mb-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
            <div className="font-semibold text-rose-200">Error</div>
            <div className="text-rose-100/80 text-sm mt-1">{err}</div>
          </div>
        )}

        {/* Filters */}
        <div className={`rounded-2xl border border-white/10 bg-white/5 p-4 ${glowClass()}`}>
          <div className="flex flex-col lg:flex-row lg:items-end gap-3 justify-between">
            <div>
              <div className="font-semibold">Command Filters</div>
              <div className="text-white/60 text-sm mt-1">
                Global view, or focus to a specific banker pipeline.
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full lg:w-[720px]">
              <input
                className="rounded-xl bg-black/40 border border-white/15 px-3 py-2 outline-none focus:border-white/30"
                placeholder="User ID (optional)"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              />
              <input
                className="rounded-xl bg-black/40 border border-white/15 px-3 py-2 outline-none focus:border-white/30"
                placeholder="Deal Type (optional)"
                value={dealType}
                onChange={(e) => setDealType(e.target.value)}
              />
              <input
                className="rounded-xl bg-black/40 border border-white/15 px-3 py-2 outline-none focus:border-white/30"
                placeholder="Stage (optional)"
                value={stage}
                onChange={(e) => setStage(e.target.value)}
              />
            </div>

            <button
              className="px-4 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 transition text-sm"
              onClick={load}
            >
              Apply
            </button>
          </div>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
          <KpiCard title="Open Deals" value={String(kpis?.totals?.openCount ?? 0)} hint="Active pipeline count" />
          <KpiCard title="Total Pipeline" value={money(kpis?.totals?.totalPipeline ?? 0)} hint="Sum of open deal amounts" />
          <KpiCard title="Weighted Pipeline" value={money(kpis?.totals?.weightedPipeline ?? 0)} hint="Probability-adjusted forecast" />
          <KpiCard title="Closings Next 30" value={String(kpis?.closingsBuckets?.next30 ?? 0)} hint="ETA-based forecast" />
        </div>

        {/* Visual Intelligence Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
          {/* Stage chart */}
          <Panel title="Pipeline by Stage" subtitle="Count + amount concentration">
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={stageData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="name" stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 11 }} />
                  <YAxis stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }}
                    formatter={(v: any, n: any) => (n === "amount" ? money(Number(v)) : v)}
                  />
                  <Bar dataKey="count" fill="#38bdf8" />
                  <Bar dataKey="amount" fill="#d946ef" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          {/* Deal type pie */}
          <Panel title="Deal Mix" subtitle="Where your pipeline is concentrated">
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Tooltip
                    contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }}
                    formatter={(v: any) => money(Number(v))}
                  />
                  <Pie data={typeData} dataKey="amount" nameKey="name" outerRadius={90} fill="#10b981">
                    {typeData.map((_, idx) => (
                      <Cell key={idx} fill={`hsl(${idx * 60}, 70%, 60%)`} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-white/70">
              {typeData.slice(0, 6).map((t: any) => (
                <div key={t.name} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                  <span className="truncate">{t.name}</span>
                  <span className="text-white/90">{money(t.amount)}</span>
                </div>
              ))}
            </div>
          </Panel>

          {/* Next Best Actions */}
          <Panel title="Next Best Actions" subtitle="Deterministic, explainable, fast wins">
            <div className="space-y-2">
              {actions.length === 0 ? (
                <div className="text-white/60 text-sm">No critical actions detected.</div>
              ) : (
                actions.map((a: any) => (
                  <div key={a.dealId} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{a.action}</div>
                      <div className="text-xs text-white/60">Deal {String(a.dealId).slice(0, 8)}…</div>
                    </div>
                    <div className="text-xs text-white/60 mt-2">
                      Evidence: {(a.evidence || []).slice(0, 2).map((e: any) => e.note).join(" • ")}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>

        {/* Predictive Watchlist */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
          <Panel title="Predictive Watchlist" subtitle="Highest probability deals (top 20)">
            <div className="space-y-2">
              {scored.length === 0 ? (
                <div className="text-white/60 text-sm">No open deals found.</div>
              ) : (
                scored.map((d: any) => (
                  <div key={d.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate">Deal {String(d.id).slice(0, 10)}…</div>
                        <div className="text-xs text-white/60 mt-1">
                          {d.stage} • {money(d.amount)} • ETA {d.eta_close_date || "—"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-xs text-white/60">Prob</div>
                        <div className="px-2 py-1 rounded-full border border-white/15 bg-white/5 text-sm">
                          {pct(d.probability)}
                        </div>
                      </div>
                    </div>
                    {(d.risk_flags || []).length > 0 && (
                      <div className="text-xs text-amber-200/90 mt-2">
                        {(d.risk_flags || []).slice(0, 2).map((f: any) => f.note).join(" • ")}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel title="Bottlenecks & Risks" subtitle="Deals that are stalling or blocked">
            <div className="space-y-2">
              {bottlenecks.length === 0 ? (
                <div className="text-white/60 text-sm">No bottlenecks detected.</div>
              ) : (
                bottlenecks.map((b: any) => (
                  <div key={b.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate">Deal {String(b.id).slice(0, 10)}…</div>
                        <div className="text-xs text-white/60 mt-1">
                          {b.stage} • {money(b.amount)} • ETA {b.eta_close_date || "—"} • Prob {pct(b.probability)}
                        </div>
                      </div>
                      <div className="px-2 py-1 rounded-full border border-amber-500/30 bg-amber-500/15 text-amber-200 text-xs">
                        Needs attention
                      </div>
                    </div>
                    <div className="text-xs text-white/70 mt-2">
                      {(b.flags || []).slice(0, 2).map((f: any) => f.note).join(" • ")}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>

        {/* Optional: Trend line (placeholder using stageData amounts) */}
        <div className="mt-4">
          <Panel title="Momentum Signal" subtitle="A simple health pulse (replace later with real daily snapshots)">
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={stageData.map((x: any, i: number) => ({ idx: i + 1, amount: x.amount }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="idx" stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 11 }} />
                  <YAxis stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }} formatter={(v: any) => money(Number(v))} />
                  <Line dataKey="amount" stroke="#10b981" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <motion.div
      className={`rounded-2xl border border-white/10 bg-white/5 p-4 ${glowClass()}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="text-xs text-white/60">{title}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      <div className="text-xs text-white/55 mt-2">{hint}</div>
    </motion.div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 p-4 ${glowClass()}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="font-semibold">{title}</div>
          <div className="text-white/60 text-sm mt-1">{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

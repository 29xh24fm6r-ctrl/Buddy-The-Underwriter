"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { emitBuddySignal } from "@/buddy/emitBuddySignal";
import { exportFindingsAsMarkdown } from "@/buddy/exportFindings";
import { exportFixSpecForFinding } from "@/buddy/exportFixSpec";
import type { FindingSeverity } from "@/buddy/findings";
import { fetchExplainDeal } from "@/buddy/explain/fetchExplainDeal";
import { getDealIdFromPath } from "@/buddy/getDealIdFromPath";
import { useBuddy } from "@/buddy/core/useBuddy";
import BuddyAvatar from "@/buddy/ui/BuddyAvatar";
import BuddyStatusDot from "@/buddy/ui/BuddyStatusDot";
import { AegisContextFindings } from "@/buddy/ui/AegisContextFindings";
import { useAegisHealth } from "@/buddy/hooks/useAegisHealth";
import type { AegisFinding } from "@/buddy/hooks/useAegisHealth";
import type { BuddySignal } from "@/buddy/types";

function envObserverEnabled() {
  return process.env.NEXT_PUBLIC_BUDDY_OBSERVER_MODE === "1";
}

const STORAGE_KEY = "buddy:observer:minimized";

export function BuddyPanel() {
  const enabled = envObserverEnabled();

  const {
    state,
    setOpen,
    startRun,
    stopRun,
    addFinding,
    updateFinding,
    setLastNudgeAtIso,
    setExplainMarkdown,
    pushToast,
    setOutcomeSnapshot,
    setPanelCollapsed,
    setPanelWidth,
  } = useBuddy();
  const pathname = usePathname();
  const [showRaw, setShowRaw] = useState(false);
  const [nowTick, setNowTick] = useState(0);
  const [panelPos, setPanelPos] = useState(() => ({ x: 16, y: 92 }));
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "1") {
        setIsMinimized(true);
      }
    } catch {
      // ignore storage errors
    }
  }, []);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const clamp = useCallback((value: number, min: number, max: number) => {
    return Math.max(min, Math.min(max, value));
  }, []);

  const isObserver = enabled && state.role === "builder";
  const open = isObserver ? true : state.isOpen;
  const panelWidth = state.panelWidth ?? 360;
  const dealId = useMemo(() => (pathname ? getDealIdFromPath(pathname) : null), [pathname]);
  const aegis = useAegisHealth({ dealId, enabled: true });
  const items = useMemo(() => {
    const signalItems = (state.signals ?? []).map((s) => ({ ...s, _source: "signal" as const }));
    const aegisItems: Array<BuddySignal & { _source: "aegis" }> = (aegis.findings ?? []).map((f: AegisFinding) => ({
      ts: Date.parse(f.createdAt),
      type: "aegis.finding" as any,
      source: f.sourceSystem ?? "aegis",
      message: f.errorMessage ?? `${f.eventType} event`,
      payload: { severity: f.severity, errorClass: f.errorClass, resolutionStatus: f.resolutionStatus },
      _source: "aegis" as const,
    }));
    return [...signalItems, ...aegisItems].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  }, [state.signals, aegis.findings]);
  const explainMd = dealId ? state.explainMarkdownByDeal?.[dealId] ?? null : null;

  const header = useMemo(() => {
    if (state.role === "builder") return "Buddy (Builder Observer)";
    if (state.role === "banker") return "Buddy (Credit Officer)";
    return "Buddy (Guide)";
  }, [state.role]);

  const handleDragStart = useCallback(
    (evt: React.PointerEvent<HTMLDivElement>) => {
      if (evt.button !== 0) return;
      const target = evt.target as HTMLElement | null;
      if (target) {
        const interactive = target.closest(
          'button, a, input, textarea, select, [role="button"], [data-no-drag="true"]'
        );
        if (interactive) return;
      }

      dragRef.current = {
        startX: evt.clientX,
        startY: evt.clientY,
        origX: panelPos.x,
        origY: panelPos.y,
      };
      evt.currentTarget.setPointerCapture(evt.pointerId);
      evt.preventDefault();
    },
    [panelPos.x, panelPos.y]
  );

  const handleDragMove = useCallback(
    (evt: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      const dx = evt.clientX - dragRef.current.startX;
      const dy = evt.clientY - dragRef.current.startY;
      const margin = 8;
      const safeWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
      const safeHeight = typeof window !== "undefined" ? window.innerHeight : 800;
      const estimatedWidth = isMinimized ? 260 : panelWidth;
      const estimatedHeight = isMinimized ? 72 : 120;
      setPanelPos({
        x: clamp(dragRef.current.origX + dx, margin, Math.max(margin, safeWidth - estimatedWidth)),
        y: clamp(dragRef.current.origY + dy, margin, Math.max(margin, safeHeight - estimatedHeight)),
      });
    },
    [clamp, isMinimized, panelWidth]
  );

  const handleDragEnd = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, isMinimized ? "1" : "0");
    } catch {
      // ignore
    }
    setPanelCollapsed(isMinimized);
  }, [isMinimized, setPanelCollapsed]);

  const toggleMinimize = useCallback(() => {
    try {
      emitBuddySignal({
        type: "user.action",
        source: "BuddyPanel.toggleMinimize",
        payload: { action: "toggle_minimize" },
      });
    } catch {
      // ignore
    }
    setIsMinimized((v) => !v);
  }, []);

  const handleRunExplain = useCallback(async () => {
    if (!dealId) return;
    const md = await fetchExplainDeal(dealId);
    setExplainMarkdown(dealId, md);
    if (md) pushToast("Explain ready");
  }, [dealId, pushToast, setExplainMarkdown]);

  const handleCopyExplain = useCallback(async () => {
    if (!dealId || !explainMd) return;
    await navigator.clipboard.writeText(explainMd);
    pushToast("Explain copied");
  }, [dealId, explainMd, pushToast]);

  const handleDownloadExplain = useCallback(() => {
    if (!dealId || !explainMd) return;
    const blob = new Blob([explainMd], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `buddy-explain-${dealId}.md`;
    link.click();
    URL.revokeObjectURL(url);
    pushToast("Explain downloaded");
  }, [dealId, explainMd, pushToast]);

  const handleCopyFindings = useCallback(async () => {
    if (!state.findings.length) {
      pushToast("No findings yet");
      return;
    }
    const md = exportFindingsAsMarkdown(state.findings);
    await navigator.clipboard.writeText(md);
    pushToast("Findings copied");
  }, [state.findings, pushToast]);

  if (!enabled) return null;

  if (!open) {
    return (
      <button
        data-testid="buddy-panel"
        className={[
          "fixed right-4 bottom-4 z-50",
          "rounded-2xl border border-white/10 bg-slate-950/80",
          "shadow-2xl backdrop-blur-xl",
          "p-2",
        ].join(" ")}
        onClick={() => setOpen(true)}
        aria-label="Open Buddy"
      >
        <BuddyAvatar size={36} healthSeverity={aegis.severity} />
      </button>
    );
  }

  return (
    <div
      data-testid="buddy-panel"
      className={[
        "fixed z-50 inline-block",
        "max-w-[90vw]",
        "rounded-2xl border border-white/10 bg-slate-950/80",
        "shadow-2xl backdrop-blur-xl text-white",
      ].join(" ")}
      style={{ width: isMinimized ? "auto" : panelWidth, left: panelPos.x, top: panelPos.y }}
    >
      <div
        className={[
          "flex items-center gap-3 px-4 py-3 select-none",
          "bg-white/5",
          isMinimized ? "rounded-2xl" : "border-b border-white/10",
          "cursor-move",
        ].join(" ")}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        data-testid="buddy-drag-handle"
      >
        <BuddyAvatar size={32} healthSeverity={aegis.severity} />
        <div className="min-w-0">
          <div className="text-sm font-semibold flex items-center gap-2">
            <span>{header}</span>
            <BuddyStatusDot healthSeverity={aegis.severity} />
          </div>
          {!isMinimized && (
            <div className="text-xs text-white/60 truncate">
              {aegis.severity === "alert"
                ? `Alert · ${aegis.counts?.critical ?? 0} critical, ${aegis.counts?.error ?? 0} errors`
                : aegis.severity === "degraded"
                  ? `Watching · ${aegis.findings.length} finding${aegis.findings.length !== 1 ? "s" : ""}`
                  : aegis.stale
                    ? "Stale data · Reconnecting..."
                    : "Persistent · Watching context · Never resets"}
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!isMinimized && (
            <>
              <span className="text-[11px] font-semibold px-2 py-1 rounded-full border border-white/15 bg-white/10">
                {state.runId ? "Run active" : "Run idle"}
              </span>
              {aegis.findings.length > 0 && (
                <span
                  className={`text-[11px] font-semibold px-2 py-1 rounded-full border ${
                    aegis.severity === "alert"
                      ? "border-red-400/40 bg-red-500/20 text-red-200"
                      : "border-amber-400/40 bg-amber-500/20 text-amber-200"
                  }`}
                >
                  {aegis.findings.length} finding{aegis.findings.length !== 1 ? "s" : ""}
                </span>
              )}
              <button
                className="text-xs px-2 py-1 rounded-full border border-white/15 bg-white/5 hover:bg-white/10"
                onClick={() => setPanelWidth(panelWidth <= 340 ? 420 : 340)}
                title="Toggle width"
              >
                {panelWidth <= 340 ? "Wider" : "Narrow"}
              </button>
            </>
          )}
          <button
            className="text-xs px-2 py-1 rounded-full border border-white/15 bg-white/5 hover:bg-white/10"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggleMinimize();
            }}
            title={isMinimized ? "Expand" : "Minimize"}
            data-testid="buddy-minimize"
            data-no-drag="true"
            aria-label={isMinimized ? "Expand Buddy panel" : "Minimize Buddy panel"}
          >
            {isMinimized ? "Expand" : "Minimize"}
          </button>
        </div>
      </div>
      {!isMinimized ? (
        <>
          <div className="px-4 py-3 border-b border-white/10">
            <div className="flex flex-wrap gap-2 items-center">
              {state.role === "builder" && (
                <>
                  <button
                    className="text-xs px-3 py-2 rounded-xl border border-white/15 bg-white/10 hover:bg-white/15"
                    onClick={() => {
                      if (state.runId) {
                        stopRun();
                        pushToast("Exploration stopped");
                      } else {
                        startRun();
                        pushToast("Exploration started");
                      }
                    }}
                  >
                    {state.runId ? "Stop run" : "Start run"}
                  </button>
                  <button
                    className="text-xs px-3 py-2 rounded-xl border border-red-200/30 bg-red-400/20 hover:bg-red-400/30"
                    onClick={() => mark("bug", state.runId ?? null, addFinding)}
                  >
                    Bug
                  </button>
                  <button
                    className="text-xs px-3 py-2 rounded-xl border border-amber-200/30 bg-amber-400/20 hover:bg-amber-400/30"
                    onClick={() => mark("confusing", state.runId ?? null, addFinding)}
                  >
                    Confusing
                  </button>
                  <button
                    className="text-xs px-3 py-2 rounded-xl border border-emerald-200/30 bg-emerald-400/20 hover:bg-emerald-400/30"
                    onClick={() => mark("magical", state.runId ?? null, addFinding)}
                  >
                    Magical
                  </button>
                  <button
                    className="text-xs px-3 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10"
                    onClick={handleCopyFindings}
                  >
                    Copy findings
                  </button>
                </>
              )}
              {!isObserver && (
                <button
                  className="text-xs px-3 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10"
                  onClick={() => setOpen(!open)}
                >
                  {open ? "Minimize" : "Open"}
                </button>
              )}
            </div>
          </div>

          <div className="bg-white text-black">
            <div className="p-4 space-y-3">
              {state.toasts && state.toasts.length > 0 && (
                <div className="space-y-1">
                  {state.toasts
                    .slice()
                    .reverse()
                    .map((t) => (
                      <div
                        key={t.id}
                        className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs text-black/70 shadow-sm"
                      >
                        {t.text}
                      </div>
                    ))}
                </div>
              )}
              {state.role === "builder" && (
                <div className="rounded-xl border border-black/10 p-3">
                  <div className="text-xs font-semibold mb-2">Exploration Run</div>
                  <div className="flex flex-wrap gap-2 items-center">
                    {state.runId ? (
                      <>
                        <button
                          className="text-xs px-3 py-1 rounded-full border border-black/10 hover:bg-black/5"
                          onClick={() => stopRun()}
                        >
                          Stop Run
                        </button>
                        <button
                          className="text-xs px-3 py-1 rounded-full border border-black/10 hover:bg-black/5"
                          onClick={() => {
                            void copyRunSummary(state.runId ?? "run", state.signals);
                            pushToast("Run summary copied");
                          }}
                        >
                          Copy Run Summary
                        </button>
                        <span className="text-[11px] text-black/60">{state.runId}</span>
                      </>
                    ) : (
                      <button
                        className="text-xs px-3 py-1 rounded-full border border-black/10 hover:bg-black/5"
                        onClick={() => startRun()}
                      >
                        Start Exploration Run
                      </button>
                    )}
                  </div>
                </div>
              )}

              {state.role === "builder" && (
                <div className="rounded-xl border border-black/10 p-3">
                  <div className="text-xs font-semibold mb-2">Quick Marks</div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <button
                      className="text-xs px-3 py-1 rounded-full border border-black/10 hover:bg-black/5"
                      onClick={() => mark("bug", state.runId ?? null, addFinding)}
                      title="Tag the current moment as a bug"
                    >
                      Mark as Bug
                    </button>
                    <button
                      className="text-xs px-3 py-1 rounded-full border border-black/10 hover:bg-black/5"
                      onClick={() => mark("confusing", state.runId ?? null, addFinding)}
                      title="Tag the current moment as confusing"
                    >
                      Mark as Confusing
                    </button>
                    <button
                      className="text-xs px-3 py-1 rounded-full border border-black/10 hover:bg-black/5"
                      onClick={() => mark("magical", state.runId ?? null, addFinding)}
                      title="Tag the current moment as magical"
                    >
                      Mark as Magical
                    </button>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-black/10 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold">Findings</div>
                  {state.findings.length > 0 && (
                    <button
                      className="text-[11px] px-2 py-1 rounded-full border border-black/10 hover:bg-black/5"
                      onClick={() => {
                        const md = exportFindingsAsMarkdown(state.findings);
                        void navigator.clipboard.writeText(md);
                        pushToast("Findings copied");
                      }}
                    >
                      Copy Findings
                    </button>
                  )}
                </div>
                {state.findings.length === 0 ? (
                  <div className="text-xs text-black/60">
                    No findings yet. Use the mark buttons while exploring.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {state.findings.map((f) => (
                      <div
                        key={f.id}
                        className="rounded-lg border border-black/10 p-2"
                        style={{
                          background:
                            f.kind === "bug"
                              ? "rgba(255,0,0,0.04)"
                              : f.kind === "confusing"
                                ? "rgba(255,165,0,0.05)"
                                : "rgba(0,128,0,0.05)",
                        }}
                      >
                        <div className="text-xs font-semibold">
                          {f.kind.toUpperCase()}
                          {f.severity !== "n/a" ? ` · ${f.severity}` : ""}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 items-center">
                          {f.kind === "bug" && (
                            <select
                              className="text-xs rounded-lg border border-black/10 px-2 py-1"
                              value={f.severity ?? "major"}
                              onChange={(e) => updateFinding(f.id, { severity: e.target.value as any })}
                            >
                              <option value="blocker">blocker</option>
                              <option value="major">major</option>
                              <option value="minor">minor</option>
                            </select>
                          )}
                          <button
                            className="text-xs px-3 py-1 rounded-full border border-black/10 hover:bg-black/5"
                            onClick={() => {
                              const md = exportFixSpecForFinding(f);
                              void navigator.clipboard.writeText(md);
                              pushToast("Fix spec copied");
                            }}
                          >
                            Copy Fix Spec
                          </button>
                        </div>
                    <div className="mt-2">
                      <textarea
                        className="w-full min-h-[54px] rounded-lg border border-black/10 px-2 py-1 text-xs"
                        value={f.note ?? ""}
                        placeholder="Add a note..."
                        onChange={(e) => updateFinding(f.id, { note: e.target.value })}
                      />
                    </div>
                    {f.path && <div className="text-[11px] text-black/60 mt-1">{f.path}</div>}
                    <div className="text-[11px] text-black/50 mt-1">
                      context signals: {f.contextSignals.length}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl bg-black/5 p-3">
            <div className="text-xs font-semibold mb-2">Latest</div>
            <div className="text-xs text-black/80">
              {state.narration?.message ?? "Standing by. Waiting for signals."}
            </div>
          </div>

          {aegis.findings.length > 0 && (
            <AegisContextFindings
              findings={aegis.findings}
              severity={aegis.severity}
              stale={aegis.stale}
              onResolve={() => aegis.refresh()}
            />
          )}

          {state.readiness ? (
            <div className="rounded-xl border border-black/10 p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold">Deal Readiness</div>
                <div className="text-sm font-extrabold">{state.readiness.readinessPct}%</div>
              </div>
              <div className="text-[11px] text-black/60 mt-1">
                {typeof state.readiness.received === "number" && typeof state.readiness.total === "number"
                  ? `${state.readiness.received} / ${state.readiness.total} docs received`
                  : "Based on latest checklist update"}
              </div>
              {state.readiness.updatedAt ? (
                <div className="text-[11px] text-black/50 mt-1">
                  Updated {timeAgo(state.readiness.updatedAt)}
                </div>
              ) : null}
              {Array.isArray(state.readiness.blockers) && state.readiness.blockers.length > 0 && (
                <div className="text-[11px] text-black/70 mt-2">
                  Blockers: {state.readiness.blockers.join(", ")}
                </div>
              )}
            </div>
          ) : null}

          {state.nextBestAction ? (
            <div className="rounded-xl border border-black/10 p-3">
              <div className="text-xs font-semibold">Next Best Action</div>
              <div className="text-xs text-black/70 mt-2">{state.nextBestAction.reason}</div>
              <div className="flex flex-col gap-2 mt-3">
                {state.nextBestAction.actions.map((a) => {
                  const cooldown =
                    a.id === "send_borrower_nudge" ? getNudgeCooldown(state.lastNudgeAtIso, nowTick) : null;
                  const disabled = Boolean(cooldown && cooldown.remainingMs > 0);
                  return (
                    <div key={a.id} className="flex items-start gap-2">
                      <button
                        className={[
                          "text-xs px-3 py-2 rounded-xl border border-black/10 bg-white",
                          disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-black/5",
                        ].join(" ")}
                        onClick={() => {
                          if (disabled) return;
                          if (state.readiness) {
                            setOutcomeSnapshot({
                              ts: Date.now(),
                              readinessPct: state.readiness.readinessPct,
                              received: state.readiness.received,
                              missing: state.readiness.missing,
                            });
                          }
                          handleNBAAction(a, setLastNudgeAtIso, pushToast);
                        }}
                        disabled={disabled}
                      >
                        {a.label}
                      </button>
                      <div className="text-[11px] text-black/60 mt-2">
                        {a.description}
                        {disabled && cooldown?.label ? ` · cooldown ${cooldown.label}` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {dealId ? (
            <div className="rounded-xl border border-black/10 p-3">
              <div className="flex flex-wrap gap-2">
                <button
                  className="text-xs px-3 py-2 rounded-xl border border-black/10 bg-white hover:bg-black/5"
                  onClick={handleRunExplain}
                >
                  Explain this deal
                </button>
                <button
                  className="text-xs px-3 py-2 rounded-xl border border-black/10 bg-white hover:bg-black/5 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleCopyExplain}
                  disabled={!explainMd}
                >
                  Copy
                </button>
                <button
                  className="text-xs px-3 py-2 rounded-xl border border-black/10 bg-white hover:bg-black/5 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleDownloadExplain}
                  disabled={!explainMd}
                >
                  Download .md
                </button>
              </div>
              {explainMd ? (
                <div className="mt-2 text-[11px] text-black/70 whitespace-pre-wrap max-h-[220px] overflow-auto">
                  {explainMd}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-xl border border-black/10 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold">Timeline</div>
              {state.role === "builder" && (
                <label className="text-[11px] text-black/60 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showRaw}
                    onChange={(e) => setShowRaw(e.target.checked)}
                  />
                  raw
                </label>
              )}
            </div>
            <div className="max-h-[260px] overflow-auto space-y-2 pr-1">
              {items.length === 0 ? (
                <div className="text-xs text-black/60">No signals yet.</div>
              ) : (
                items.map((s, idx) => (
                  <div
                    key={`${s.ts}-${idx}`}
                    className={[
                      "rounded-lg bg-white border border-black/10 p-2",
                      (s as any)._source === "aegis" ? "border-l-4 border-l-amber-400" : "",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold flex items-center gap-1.5">
                        {(s as any)._source === "aegis" && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">AEGIS</span>
                        )}
                        {labelFor(s)}
                      </div>
                      <div className="text-[10px] text-black/50">{timeAgo(s.ts)}</div>
                    </div>
                    <div className="text-xs text-black/70 mt-1">{summaryFor(s)}</div>
                    {showRaw && (
                      <pre className="mt-2 text-[10px] text-black/60 whitespace-pre-wrap break-words">
                        {JSON.stringify(
                          {
                            type: s.type,
                            source: s.source,
                            dealId: s.dealId,
                            payload: s.payload,
                            action: s.action,
                            route: s.route,
                            page: s.page,
                          },
                          null,
                          2
                        )}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="text-[11px] text-black/50">
            Builder mode is always-open. For borrower/banker, Buddy can be minimized by default.
          </div>
        </div>
      </div>
    </>
  ) : null}
    </div>
  );
}

function labelFor(s: BuddySignal) {
  if ((s.type as string) === "aegis.finding") return "Aegis Finding";
  switch (s.type) {
    case "page.ready":
      return "Page ready";
    case "deal.loaded":
      return "Deal loaded";
    case "checklist.updated":
      return "Checklist updated";
    case "pipeline.event":
      return "Pipeline event";
    case "user.action":
      return "User action";
    case "user.mark":
      return "User mark";
    case "ui.toast":
      return "UI toast";
    case "error":
      return "Error";
    default:
      return s.action ? `Signal: ${s.action}` : s.type ?? "Signal";
  }
}

function summaryFor(s: BuddySignal) {
  if (s.type === ("aegis.finding" as any)) {
    const cls = s.payload?.errorClass ? `[${String(s.payload.errorClass)}] ` : "";
    const status = s.payload?.resolutionStatus ? ` · ${String(s.payload.resolutionStatus)}` : "";
    return `${cls}${s.message ?? "Aegis event"}${status}`;
  }
  if (s.type === "checklist.updated") {
    const received = s.payload?.received;
    const missing = s.payload?.missing;
    if (typeof received === "number" && typeof missing === "number") {
      return `${received} received · ${missing} missing`;
    }
  }
  if (s.type === "user.action") {
    const action = s.payload?.action ?? s.action;
    if (action) return String(action);
  }
  if (s.type === "user.mark") {
    const mark = String(s.payload?.mark ?? "mark").toUpperCase();
    const note = s.payload?.note ? ` — ${String(s.payload.note)}` : "";
    const path = s.payload?.path ? ` (${String(s.payload.path)})` : "";
    return `${mark}${note}${path}`;
  }
  if (s.type === "ui.toast") {
    return String(s.payload?.text ?? "Toast");
  }
  if (s.dealId) return `dealId: ${s.dealId}`;
  if (s.source) return s.source;
  return s.message ?? "Signal received.";
}

function timeAgo(ts?: number) {
  const safeTs = Number.isFinite(ts) ? (ts as number) : Date.now();
  const delta = Date.now() - safeTs;
  const sec = Math.max(0, Math.floor(delta / 1000));
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

async function copyRunSummary(runId: string, signals: BuddySignal[]) {
  let lines: string[] | null = null;

  try {
    const res = await fetch(`/api/_buddy/runs/${runId}/summary`, { cache: "no-store" });
    const json = await res.json();
    if (res.ok && json?.ok && Array.isArray(json.events)) {
      lines = json.events.map((ev: any) => {
        const t = new Date(ev.ts ?? Date.now()).toISOString();
        const kind = String(ev.kind ?? ev.type ?? "event");
        const extra =
          kind === "user.action"
            ? ` action=${String(ev.payload?.action ?? ev.payload?.testid ?? "")}`.trim()
            : "";
        const msg =
          kind === "error"
            ? ` ERROR: ${String(ev.payload?.message ?? ev.payload?.reason ?? "unknown")}`
            : kind === "user.mark"
              ? ` ${String(ev.payload?.mark ?? "mark").toUpperCase()}: ${String(
                  ev.payload?.note ?? "(no note)"
                )} @ ${String(ev.payload?.path ?? ev.payload?.route ?? "")}`.trim()
              : ` ${String(ev.payload?.summary ?? ev.payload?.text ?? "") || kind}`;
        return `- ${t} · ${kind}${extra} ·${msg}`;
      });
    }
  } catch {
    // ignore
  }

  if (!lines) {
    const relevant = signals.filter(
      (s) => s.payload?.runId === runId || s.type === "error" || s.type === "user.mark"
    );
    lines = relevant.map((s) => {
      const t = new Date(s.ts ?? Date.now()).toISOString();
      const extra =
        s.type === "user.action"
          ? ` action=${String(s.payload?.action ?? s.payload?.testid ?? "")}`.trim()
          : "";
      const msg =
        s.type === "error"
          ? ` ERROR: ${String(s.payload?.message ?? s.payload?.reason ?? "unknown")}`
          : s.type === "user.mark"
            ? ` ${String(s.payload?.mark ?? "mark").toUpperCase()}: ${String(
                s.payload?.note ?? "(no note)"
              )} @ ${String(s.payload?.path ?? "")}`.trim()
            : ` ${summaryFor(s)}`;
      return `- ${t} · ${s.type}${extra} ·${msg}`;
    });
  }

  const out = `# Buddy Exploration Run\n\nRun: ${runId}\n\n## Timeline\n${lines.join("\n")}\n`;

  try {
    void navigator.clipboard.writeText(out);
  } catch {
    // ignore
  }
}

function mark(
  kind: "bug" | "confusing" | "magical",
  runId: string | null,
  addFinding: (input: {
    kind: "bug" | "confusing" | "magical";
    severity?: "blocker" | "major" | "minor" | "n/a";
    note?: string;
    path?: string;
    sourceSignalTs: number;
  }) => void
) {
  let severity: FindingSeverity = "n/a";
  if (kind === "bug") {
    const s =
      (window.prompt("Bug severity? blocker / major / minor", "major") ?? "major")
        .trim()
        .toLowerCase();
    severity = (s === "blocker" || s === "major" || s === "minor" ? s : "major") as FindingSeverity;
  }

  const note =
    window.prompt(
      kind === "bug"
        ? "What broke? (short note)"
        : kind === "confusing"
          ? "What was confusing? (short note)"
          : "What felt magical? (short note)",
      ""
    ) ?? "";

  emitBuddySignal({
    type: "user.mark",
    source: "BuddyPanel.mark",
    payload: {
      runId: runId ?? undefined,
      mark: kind,
      severity: severity !== "n/a" ? severity : undefined,
      note: note.trim() || undefined,
      path: typeof window !== "undefined" ? window.location.pathname : undefined,
    },
  });

  addFinding({
    kind,
    severity,
    note: note.trim() || undefined,
    path: typeof window !== "undefined" ? window.location.pathname : undefined,
    sourceSignalTs: Date.now(),
  });
}

function handleNBAAction(
  action: { id: string; payload?: Record<string, any> },
  setLastNudgeAtIso: (iso: string | null) => void,
  pushToast: (text: string) => void
) {
  if (action.id === "upload_docs") {
    pushToast("Prompted borrower for docs");
    return;
  }

  if (action.id === "request_missing_docs") {
    if (!action.payload?.dealId) return;
    void fetch(`/api/deals/${action.payload.dealId}/borrower-request/send`, { method: "POST" });
    pushToast("Missing docs requested");
    return;
  }

  if (action.id === "send_borrower_nudge") {
    if (!action.payload?.dealId) return;
    void fetch(`/api/deals/${action.payload.dealId}/borrower-nudge`, {
      method: "POST",
    });
    setLastNudgeAtIso(new Date().toISOString());
    pushToast("Nudge sent");
    return;
  }

  if (action.id === "run_reconcile") {
    if (!action.payload?.dealId) return;
    void fetch(`/api/deals/${action.payload.dealId}/checklist/reconcile`, { method: "POST" });
    pushToast("Checklist reconcile started");
    return;
  }

  if (action.id === "start_underwriting") {
    if (!action.payload?.dealId) return;
    pushToast("Opening underwriting");
    window.location.href = `/deals/${action.payload.dealId}/underwrite`;
  }
}

function getNudgeCooldown(lastNudgeAtIso?: string | null, nowMs?: number) {
  if (!lastNudgeAtIso) return null;
  const last = Date.parse(lastNudgeAtIso);
  if (!Number.isFinite(last)) return null;
  const elapsedMs = (nowMs ?? Date.now()) - last;
  const cooldownMs = 24 * 60 * 60 * 1000;
  const remainingMs = Math.max(0, cooldownMs - elapsedMs);
  if (remainingMs <= 0) return { remainingMs: 0, label: "ready" };
  const totalMinutes = Math.ceil(remainingMs / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const label = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return { remainingMs, label };
}

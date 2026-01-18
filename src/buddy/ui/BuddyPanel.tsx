"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { emitBuddySignal } from "@/buddy/emitBuddySignal";
import { exportFindingsAsMarkdown } from "@/buddy/exportFindings";
import { exportFixSpecForFinding } from "@/buddy/exportFixSpec";
import type { FindingSeverity } from "@/buddy/findings";
import { fetchExplainDeal } from "@/buddy/explain/fetchExplainDeal";
import { getDealIdFromPath } from "@/buddy/getDealIdFromPath";
import { useBuddy } from "@/buddy/core/useBuddy";
import type { BuddySignal } from "@/buddy/types";

function envObserverEnabled() {
  return process.env.NEXT_PUBLIC_BUDDY_OBSERVER_MODE === "1";
}

export function BuddyPanel() {
  if (!envObserverEnabled()) return null;

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
  } = useBuddy();
  const pathname = usePathname();
  const [showRaw, setShowRaw] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const isObserver = envObserverEnabled() && state.role === "builder";
  const open = isObserver ? true : state.isOpen;
  const items = useMemo(() => (state.signals ?? []).slice().reverse(), [state.signals]);
  const dealId = useMemo(() => (pathname ? getDealIdFromPath(pathname) : null), [pathname]);
  const explainMd = dealId ? state.explainMarkdownByDeal?.[dealId] ?? null : null;

  const header = useMemo(() => {
    if (state.role === "builder") return "Buddy (Builder Observer)";
    if (state.role === "banker") return "Buddy (Credit Officer)";
    return "Buddy (Guide)";
  }, [state.role]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const handleRunExplain = useCallback(async () => {
    if (!dealId) return;
    const md = await fetchExplainDeal(dealId);
    setExplainMarkdown(dealId, md);
    if (md) pushToast("Explain ready");
  }, [dealId, pushToast, setExplainMarkdown, fetchExplainDeal]);

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

  return (
    <div
      data-testid="buddy-panel"
      className={[
        "fixed right-4 bottom-4 z-50",
        "w-[420px] max-w-[90vw]",
        "rounded-2xl shadow-lg border border-black/10 bg-white",
      ].join(" ")}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
        <div className="flex items-center gap-3">
          <BuddyAvatar />
          <div>
            <div className="text-sm font-semibold">{header}</div>
            <div className="text-xs text-black/60">Persistent • Watching context • Never resets</div>
          </div>
        </div>

        {!isObserver && (
          <button
            className="text-xs px-3 py-1 rounded-full border border-black/10 hover:bg-black/5"
            onClick={() => setOpen(!open)}
          >
            {open ? "Minimize" : "Open"}
          </button>
        )}
      </div>

      {open && (
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
                        copyRunSummary(state.runId ?? "run", state.signals);
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
                  <div key={`${s.ts}-${idx}`} className="rounded-lg bg-white border border-black/10 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold">{labelFor(s)}</div>
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
      )}
    </div>
  );
}

function labelFor(s: BuddySignal) {
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

function copyRunSummary(runId: string, signals: BuddySignal[]) {
  const relevant = signals.filter(
    (s) => s.payload?.runId === runId || s.type === "error" || s.type === "user.mark"
  );
  const lines = relevant.map((s) => {
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

function BuddyAvatar() {
  return (
    <div
      aria-label="Buddy avatar"
      className="h-9 w-9 rounded-xl border border-black/10 bg-white/70 shadow-[0_2px_10px_rgba(0,0,0,0.06)] grid place-items-center"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path
          d="M8 6.5C8 4.6 9.6 3 11.5 3h1C14.4 3 16 4.6 16 6.5V7H8v-.5Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M7 7h10a3 3 0 0 1 3 3v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-6a3 3 0 0 1 3-3Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M9.2 12.2h.1M14.7 12.2h.1"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M9.5 15.5c.9.8 2 1.2 3.1 1.2s2.2-.4 3.1-1.2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
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
    window.location.href = `/underwrite/${action.payload.dealId}`;
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

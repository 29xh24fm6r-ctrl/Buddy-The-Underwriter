// src/components/deals/interview/DealInterviewPanel.tsx
"use client";

import React, { useMemo, useRef, useState, useEffect } from "react";
import VoiceInterviewButton from "@/components/deals/VoiceInterviewButton";
import InterviewProgressCard from "@/components/deals/interview/InterviewProgressCard";
import NextQuestionCard from "@/components/deals/interview/NextQuestionCard";
import { BorrowerHelpCenterCard } from "@/components/deals/interview/BorrowerHelpCenterCard";
import { BorrowerQaModal } from "@/components/deals/interview/BorrowerQaModal";
import LiveDocumentChecklistCard from "@/components/deals/interview/LiveDocumentChecklistCard";
import ShareUploadLinkCard from "@/components/deals/interview/ShareUploadLinkCard";

type Session = {
  id: string;
  deal_id: string;
  created_by: string;
  status: "active" | "completed" | "abandoned";
  mode: "text" | "voice" | "mixed";
  title: string | null;
  metadata: any;
  created_at: string;
};

type Turn = {
  id: string;
  session_id: string;
  role: "buddy" | "borrower" | "banker";
  text: string;
  payload: any;
  created_at: string;
};

type Fact = {
  id: string;
  session_id: string;
  deal_id: string;
  field_key: string;
  field_value: any;
  value_text: string | null;
  source_type: "turn" | "document" | "manual";
  source_turn_id: string | null;
  confirmed: boolean;
  confirmed_at: string | null;
  confidence: number | null;
  metadata: any;
  created_at: string;
};

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) throw new Error(json?.error || `request_failed_${res.status}`);
  return json as T;
}

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function prettyValue(v: any) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function parseSmartValue(raw: string) {
  const t = raw.trim();
  if (!t) return null;

  const num = t.replace(/[$,]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(num)) return Number(num);

  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      return JSON.parse(t);
    } catch {}
  }

  if (t.toLowerCase() === "true") return true;
  if (t.toLowerCase() === "false") return false;
  return t;
}

function downloadText(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DealInterviewPanel({ dealId }: { dealId: string }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);

  const [plan, setPlan] = useState<any>(null);
  const [planBusy, setPlanBusy] = useState(false);

  // Q&A modal
  const [qaOpen, setQaOpen] = useState(false);

  // View mode toggle
  const [viewMode, setViewMode] = useState<"banker" | "borrower">("borrower");

  // Banker-only controls
  const [newTitle, setNewTitle] = useState("SBA Intake");
  const [newMode, setNewMode] = useState<"text" | "voice" | "mixed">("mixed");

  const [turnRole, setTurnRole] = useState<"buddy" | "borrower" | "banker">("borrower");
  const [turnText, setTurnText] = useState("");

  const [factKey, setFactKey] = useState("requested_amount");
  const [factValueRaw, setFactValueRaw] = useState("750000");
  const [factValueText, setFactValueText] = useState("$750,000");
  const [factSourceTurnId, setFactSourceTurnId] = useState<string | null>(null);
  const manualFactKeyInputRef = useRef<HTMLInputElement | null>(null);

  const suggestedFacts = useMemo(() => {
    return facts
      .filter((f) => !f.confirmed && !!f.metadata?.suggested)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [facts]);

  async function loadSessions() {
    const out = await api<{ sessions: Session[] }>(`/api/deals/${dealId}/interview/sessions`, { method: "GET" });
    setSessions(out.sessions || []);
    return out.sessions || [];
  }

  async function loadTurns(sessionId: string) {
    const out = await api<{ turns: Turn[] }>(`/api/deals/${dealId}/interview/sessions/${sessionId}/turns`, { method: "GET" });
    setTurns(out.turns || []);
  }

  async function loadFacts(sessionId: string) {
    const out = await api<{ facts: Fact[] }>(`/api/deals/${dealId}/interview/sessions/${sessionId}/facts`, { method: "GET" });
    setFacts(out.facts || []);
  }

  async function refreshPlan(sessionId: string) {
    setPlanBusy(true);
    try {
      const out = await api<{ plan: any }>(`/api/deals/${dealId}/interview/sessions/${sessionId}/question-plan/next`, { method: "GET" });
      setPlan(out.plan);
    } catch (e: any) {
      console.warn("plan_failed", e?.message || e);
    } finally {
      setPlanBusy(false);
    }
  }

  async function bootstrap() {
    setLoading(true);
    setError(null);
    try {
      const s = await loadSessions();
      const pick = s?.[0]?.id ?? null;
      setActiveSessionId(pick);
      if (pick) {
        await Promise.all([loadTurns(pick), loadFacts(pick)]);
        await refreshPlan(pick);
      } else {
        setTurns([]);
        setFacts([]);
        setPlan(null);
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  async function onSelectSession(sessionId: string) {
    setError(null);
    setActiveSessionId(sessionId);
    setBusy("load_session");
    try {
      await Promise.all([loadTurns(sessionId), loadFacts(sessionId)]);
      setFactSourceTurnId(null);
      await refreshPlan(sessionId);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  }

  async function onCreateSession() {
    setError(null);
    setBusy("create_session");
    try {
      const out = await api<{ session: Session }>(`/api/deals/${dealId}/interview/sessions`, {
        method: "POST",
        body: JSON.stringify({ title: newTitle, mode: newMode }),
      });

      const created = out.session;
      setSessions((prev) => [created, ...prev]);
      setActiveSessionId(created.id);
      await Promise.all([loadTurns(created.id), loadFacts(created.id)]);
      await refreshPlan(created.id);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  }

  async function onAskNowFromPlan(q: { question: string; question_key: string }) {
    if (!activeSessionId) return;
    setBusy("ask_now");
    try {
      const out = await api<{ turn: Turn }>(`/api/deals/${dealId}/interview/sessions/${activeSessionId}/turns`, {
        method: "POST",
        body: JSON.stringify({
          role: "buddy",
          text: q.question,
          payload: { question_key: q.question_key, plan_version: "v1", channel: "text" },
        }),
      });
      setTurns((prev) => [...prev, out.turn]);
      await refreshPlan(activeSessionId);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  }

  async function onAddTurn() {
    if (!activeSessionId) return;
    setError(null);
    setBusy("add_turn");
    try {
      const out = await api<{ turn: Turn }>(`/api/deals/${dealId}/interview/sessions/${activeSessionId}/turns`, {
        method: "POST",
        body: JSON.stringify({ role: turnRole, text: turnText }),
      });

      setTurns((prev) => [...prev, out.turn]);
      setTurnText("");
      await refreshPlan(activeSessionId);
      await loadFacts(activeSessionId);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  }

  async function onAddFact() {
    if (!activeSessionId) return;
    setError(null);
    setBusy("add_fact");
    try {
      const field_value = parseSmartValue(factValueRaw);
      if (field_value === null) throw new Error("fact_value_required");

      const out = await api<{ fact: Fact }>(`/api/deals/${dealId}/interview/sessions/${activeSessionId}/facts`, {
        method: "POST",
        body: JSON.stringify({
          field_key: factKey.trim(),
          field_value,
          value_text: factValueText?.trim() ? factValueText.trim() : null,
          source_type: factSourceTurnId ? "turn" : "manual",
          source_turn_id: factSourceTurnId,
        }),
      });

      setFacts((prev) => [out.fact, ...prev]);
      await loadFacts(activeSessionId);
      await refreshPlan(activeSessionId);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  }

  async function onToggleConfirm(fact: Fact, confirmed: boolean) {
    if (!activeSessionId) return;
    setError(null);
    setBusy(`confirm_${fact.id}`);
    try {
      const out = await api<{ fact: Fact }>(
        `/api/deals/${dealId}/interview/sessions/${activeSessionId}/facts/${fact.id}/confirm`,
        { method: "POST", body: JSON.stringify({ confirmed }) }
      );
      setFacts((prev) => prev.map((f) => (f.id === fact.id ? out.fact : f)));
      await loadFacts(activeSessionId);
      await refreshPlan(activeSessionId);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  }

  async function onDownloadSummary() {
    if (!activeSessionId) return;
    setBusy("download_summary");
    setError(null);
    try {
      const out = await api<any>(`/api/deals/${dealId}/interview/sessions/${activeSessionId}/summary`, { method: "GET" });

      downloadText(`buddy_intake_${dealId}_${activeSessionId}.json`, JSON.stringify(out, null, 2), "application/json;charset=utf-8");
      downloadText(`buddy_intake_${dealId}_${activeSessionId}.md`, String(out.markdown || ""), "text/markdown;charset=utf-8");
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  }

  const canCreate = !busy && newTitle.trim().length > 0;
  const canAddTurn = !busy && !!activeSessionId && turnText.trim().length > 0;
  const canAddFact = !busy && !!activeSessionId && factKey.trim().length > 0 && factValueRaw.trim().length > 0;

  const jumpToMissingKey = (key: string) => {
    setFactKey(key);
    setTimeout(() => manualFactKeyInputRef.current?.focus(), 50);
  };

  // Upload focus hook (Share link adds ?focus=upload)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const focus = params.get("focus");
    if (focus === "upload") {
      // no-op placeholder: Live checklist already has Upload button
    }
  }, []);

  return (
    <>
      <BorrowerQaModal open={qaOpen} onClose={() => setQaOpen(false)} dealId={dealId} sessionId={activeSessionId} />

      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <div className="text-lg font-semibold">Borrower Intake</div>
          <div className="text-xs text-muted-foreground">Everything here is driven by confirmed facts and real document evidence.</div>
        </div>

        <div className="flex items-center gap-2">
          <div className="rounded-md border p-1 text-sm">
            <button
              type="button"
              className={cx("rounded-md px-3 py-2 text-sm", viewMode === "borrower" ? "bg-accent" : "hover:bg-accent")}
              onClick={() => setViewMode("borrower")}
            >
              Borrower View
            </button>
            <button
              type="button"
              className={cx("rounded-md px-3 py-2 text-sm", viewMode === "banker" ? "bg-accent" : "hover:bg-accent")}
              onClick={() => setViewMode("banker")}
            >
              Banker View
            </button>
          </div>

          <button
            type="button"
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
            onClick={() => setQaOpen(true)}
            disabled={!activeSessionId}
            title={!activeSessionId ? "Create/select a session first" : "Ask Buddy"}
          >
            Ask Buddy
          </button>

          <button
            type="button"
            className={cx("rounded-md border px-3 py-2 text-sm hover:bg-accent", !activeSessionId && "opacity-60")}
            onClick={onDownloadSummary}
            disabled={!activeSessionId || !!busy}
            title={!activeSessionId ? "Create/select a session first" : "Download intake summary (JSON + MD)"}
          >
            {busy === "download_summary" ? "Preparing..." : "Download summary"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* LEFT COLUMN */}
        <div className={cx("space-y-6", viewMode === "banker" ? "lg:col-span-4" : "lg:col-span-4")}>
          <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
            <div className="font-semibold">Voice (Realtime)</div>
            <div className="text-xs text-muted-foreground">Say "I have a question" anytime.</div>
            <VoiceInterviewButton
              dealId={dealId}
              sessionId={activeSessionId}
              onSavedTurn={async (t, extras) => {
                setTurns((prev) => [...prev, t]);
                if (activeSessionId) {
                  await loadFacts(activeSessionId);
                  if (extras?.plan) setPlan(extras.plan);
                  else await refreshPlan(activeSessionId);
                }
              }}
            />
          </div>

          <ShareUploadLinkCard dealId={dealId} sessionId={activeSessionId} basePath="/deals" />

          {viewMode === "banker" ? (
            <>
              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">Interview Sessions</div>
                  <button className={cx("rounded-md border px-2 py-1 text-xs", busy ? "opacity-60" : "hover:bg-accent")} disabled={!!busy} onClick={() => bootstrap()}>
                    Refresh
                  </button>
                </div>

                <div className="mt-3 space-y-2">
                  {sessions.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No sessions yet.</div>
                  ) : (
                    sessions.map((s) => (
                      <button
                        key={s.id}
                        className={cx("w-full rounded-lg border px-3 py-2 text-left text-sm", s.id === activeSessionId ? "bg-accent" : "hover:bg-accent/50")}
                        onClick={() => onSelectSession(s.id)}
                        disabled={!!busy}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium truncate">{s.title || "Untitled session"}</div>
                          <span className="text-[11px] text-muted-foreground">{s.status}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">{formatWhen(s.created_at)}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
                <div className="font-semibold">Create Session</div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Title</label>
                  <input className="w-full rounded-md border px-3 py-2 text-sm" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Mode</label>
                  <select className="w-full rounded-md border px-3 py-2 text-sm" value={newMode} onChange={(e) => setNewMode(e.target.value as any)}>
                    <option value="mixed">mixed</option>
                    <option value="text">text</option>
                    <option value="voice">voice</option>
                  </select>
                </div>

                <button className={cx("w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground", !canCreate && "opacity-60")} disabled={!canCreate} onClick={onCreateSession}>
                  {busy === "create_session" ? "Creating..." : "Create session"}
                </button>
              </div>

              <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
                <div className="font-semibold">Add Turn (Manual)</div>
                <div className="grid grid-cols-3 gap-2">
                  <select className="col-span-1 rounded-md border px-2 py-2 text-sm" value={turnRole} onChange={(e) => setTurnRole(e.target.value as any)} disabled={!activeSessionId || !!busy}>
                    <option value="borrower">borrower</option>
                    <option value="buddy">buddy</option>
                    <option value="banker">banker</option>
                  </select>
                  <button className={cx("col-span-2 rounded-md border px-3 py-2 text-sm", !activeSessionId ? "opacity-60" : "hover:bg-accent")} disabled={!activeSessionId || !!busy} onClick={() => activeSessionId && onSelectSession(activeSessionId)}>
                    Reload
                  </button>
                </div>

                <textarea className="h-28 w-full rounded-md border px-3 py-2 text-sm" value={turnText} onChange={(e) => setTurnText(e.target.value)} disabled={!activeSessionId || !!busy} />

                <button className={cx("w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground", !canAddTurn && "opacity-60")} disabled={!canAddTurn} onClick={onAddTurn}>
                  {busy === "add_turn" ? "Adding..." : "Add turn"}
                </button>
              </div>
            </>
          ) : null}
        </div>

        {/* RIGHT COLUMN */}
        <div className="lg:col-span-8 space-y-6">
          <InterviewProgressCard facts={facts as any} onJumpToMissingKey={jumpToMissingKey} />

          <NextQuestionCard plan={plan} disabled={!activeSessionId || !!busy || planBusy} onAskNow={onAskNowFromPlan} />

          <BorrowerHelpCenterCard facts={facts as any} onOpenQa={() => setQaOpen(true)} />

          <LiveDocumentChecklistCard
            dealId={dealId}
            facts={facts as any}
            onOpenUpload={() => {
              // you already have UploadBox somewhere on the deal page; this keeps UX consistent
              // If you later add a dedicated Upload modal, wire it here.
              setQaOpen(false);
            }}
          />

          {/* Suggested facts */}
          {activeSessionId && suggestedFacts.length > 0 ? (
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">Suggested Facts (from transcript)</div>
                  <div className="text-xs text-muted-foreground">Confirming turns these into provable facts.</div>
                </div>

                <button
                  type="button"
                  className={cx("rounded-md px-3 py-2 text-sm font-medium", busy ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground hover:opacity-90")}
                  disabled={!!busy}
                  onClick={async () => {
                    if (!activeSessionId) return;
                    setBusy("confirm_all");
                    try {
                      const factIds = suggestedFacts.map((f) => f.id);
                      await api(`/api/deals/${dealId}/interview/sessions/${activeSessionId}/facts/confirm-batch`, {
                        method: "POST",
                        body: JSON.stringify({ factIds, confirmed: true }),
                      });
                      await loadFacts(activeSessionId);
                      await refreshPlan(activeSessionId);
                    } catch (e: any) {
                      setError(String(e?.message || e));
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Confirm all
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {suggestedFacts.slice(0, 10).map((f) => {
                  const isBusy = busy === `confirm_${f.id}`;
                  return (
                    <div key={f.id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm">{f.field_key}</span>
                            {typeof f.confidence === "number" ? <span className="text-[11px] text-muted-foreground">conf: {f.confidence.toFixed(2)}</span> : null}
                          </div>
                          <div className="mt-1 text-sm">{f.value_text || prettyValue(f.field_value)}</div>
                          {f.metadata?.rationale ? <div className="mt-2 text-[11px] text-muted-foreground">evidence: {String(f.metadata.rationale)}</div> : null}
                        </div>

                        <button className={cx("rounded-md border px-3 py-2 text-sm", isBusy && "opacity-60", "hover:bg-accent")} disabled={!!busy} onClick={async () => onToggleConfirm(f, true)}>
                          {isBusy ? "Saving..." : "Confirm"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Banker-only manual fact entry */}
          {viewMode === "banker" ? (
            <div className="rounded-xl border bg-card p-4 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold">Add Candidate Fact (Manual)</div>
                <div className="text-xs text-muted-foreground">Facts are not real until confirmed.</div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">field_key</label>
                  <input ref={manualFactKeyInputRef} className="w-full rounded-md border px-3 py-2 text-sm" value={factKey} onChange={(e) => setFactKey(e.target.value)} disabled={!activeSessionId || !!busy} />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">value_text (optional)</label>
                  <input className="w-full rounded-md border px-3 py-2 text-sm" value={factValueText} onChange={(e) => setFactValueText(e.target.value)} disabled={!activeSessionId || !!busy} />
                </div>

                <div className="md:col-span-2 space-y-2">
                  <label className="text-xs text-muted-foreground">field_value (number/string/json)</label>
                  <input className="w-full rounded-md border px-3 py-2 text-sm font-mono" value={factValueRaw} onChange={(e) => setFactValueRaw(e.target.value)} disabled={!activeSessionId || !!busy} />
                </div>
              </div>

              <button className={cx("w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground", !canAddFact && "opacity-60")} disabled={!canAddFact} onClick={onAddFact}>
                {busy === "add_fact" ? "Adding..." : "Add candidate fact"}
              </button>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
              <div className="font-medium">Error</div>
              <div className="mt-1 font-mono text-xs">{error}</div>
            </div>
          ) : null}

          {loading ? <div className="text-sm text-muted-foreground">Loading intake…</div> : null}
        </div>
      </div>
    </>
  );
}

import type { BuddyObserverInsight, BuddyRole, BuddySignal } from "@/buddy/types";
import type { BuddyFinding, FindingKind, FindingSeverity } from "@/buddy/findings";
import { getDealIdFromPath } from "../getDealIdFromPath";
import type { NBASuggestion } from "@/buddy/nba/types";
import type { ReadinessBreakdown } from "@/buddy/readiness/calcReadiness";
import type { OutcomeSnapshot } from "@/buddy/outcomes/types";

export type BuddySessionState = {
  role: BuddyRole;
  dealId?: string | null;

  narration?: { message: string; tone?: string } | null;

  // Exploration run
  runId?: string | null;
  runStartedAt?: number | null;

  // UI state
  isOpen: boolean;
  panelCollapsed?: boolean;
  panelWidth?: number;

  // Observer feed
  signals: BuddySignal[];
  insights: BuddyObserverInsight[];

  // Last user action snapshot
  lastAction?: {
    ts: number;
    testid?: string;
    action?: string;
    text?: string;
    path?: string;
  } | null;

  // Findings
  findings: BuddyFinding[];

  // Next best action
  nextBestAction?: NBASuggestion | null;

  // Readiness
  readiness?: ReadinessBreakdown | null;

  // Nudge cooldown
  lastNudgeAtIso?: string | null;

  // Outcome awareness
  lastOutcomeSnapshot?: OutcomeSnapshot | null;

  // Readiness setter
  setReadiness?: (r: ReadinessBreakdown | null) => void;

  // Nudge setter
  setLastNudgeAtIso?: (v: string | null) => void;

  // Explain deal cache
  explainMarkdownByDeal?: Record<string, string>;
  
  // Toasts
  toasts?: Array<{ id: string; ts: number; text: string }>;
  setExplainMarkdown?: (dealId: string, md: string) => void;

  // Minimal continuity
  lastRoute?: string;
  lastPage?: string;
};

const KEY = "buddy.session.v1";

let currentState: BuddySessionState | null = null;

export const buddySessionStore = {
  getState(): BuddySessionState {
    if (currentState) return currentState;
    currentState = getDefaultState();
    return currentState;
  },
  setState(next: BuddySessionState) {
    currentState = next;
  },
};

function now() {
  return Date.now();
}

function getDefaultState(): BuddySessionState {
  const isOpen = process.env.NEXT_PUBLIC_BUDDY_DEFAULT_OPEN === "1";
  return {
    role: (process.env.NEXT_PUBLIC_BUDDY_ROLE as BuddyRole) || "builder",
    dealId: null,
    isOpen,
    panelCollapsed: false,
    panelWidth: 360,
    signals: [],
    insights: [],
    narration: null,
    findings: [],
    lastAction: null,
    nextBestAction: null,
    readiness: null,
    lastNudgeAtIso: null,
    lastOutcomeSnapshot: null,
    explainMarkdownByDeal: {},
    toasts: [],
    runId: null,
    runStartedAt: null,
  };
}

export function setReadiness(state: BuddySessionState, r: ReadinessBreakdown | null): BuddySessionState {
  return { ...state, readiness: r };
}

export function setLastNudgeAtIso(state: BuddySessionState, v: string | null): BuddySessionState {
  return { ...state, lastNudgeAtIso: v };
}

export function setExplainMarkdown(
  state: BuddySessionState,
  dealId: string,
  md: string
): BuddySessionState {
  return {
    ...state,
    explainMarkdownByDeal: { ...(state.explainMarkdownByDeal ?? {}), [dealId]: md },
  };
}

export function loadBuddySession(): BuddySessionState {
  if (typeof window === "undefined") return getDefaultState();
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return getDefaultState();
    const parsed = JSON.parse(raw) as BuddySessionState;
    const hydrated = { ...getDefaultState(), ...parsed };
    buddySessionStore.setState(hydrated);
    return hydrated;
  } catch {
    return getDefaultState();
  }
}

export function saveBuddySession(state: BuddySessionState) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(state));
    buddySessionStore.setState(state);
  } catch {
    // ignore
  }
}

export function appendSignal(state: BuddySessionState, sig: BuddySignal): BuddySessionState {
  const s: BuddySignal = { ...sig, ts: sig.ts ?? now() };
  const signals = [...state.signals, s].slice(-200);
  const next: BuddySessionState = { ...state, signals };
  if (s.type === "user.action") {
    next.lastAction = {
      ts: s.ts ?? now(),
      testid: s.payload?.testid,
      action: s.payload?.action,
      text: s.payload?.text,
      path: s.payload?.path,
    };
  }
  return next;
}

export function startRun(state: BuddySessionState): BuddySessionState {
  const ts = now();
  const id = `run_${ts}`;
  return { ...state, runId: id, runStartedAt: ts };
}

export function stopRun(state: BuddySessionState): BuddySessionState {
  return { ...state, runId: null, runStartedAt: null };
}

export function appendInsight(
  state: BuddySessionState,
  insight: Omit<BuddyObserverInsight, "ts">
): BuddySessionState {
  const i: BuddyObserverInsight = { ts: now(), ...insight };
  const insights = [i, ...state.insights].slice(0, 200); // newest first
  return { ...state, insights };
}

export function addFinding(
  state: BuddySessionState,
  input: {
    kind: FindingKind;
    severity?: FindingSeverity;
    note?: string;
    path?: string;
    sourceSignalTs: number;
  }
): BuddySessionState {
  const windowMs = 10_000;
  const sourceTs = Number.isFinite(input.sourceSignalTs) ? input.sourceSignalTs : now();
  const contextSignals = (state.signals ?? []).filter((s) => {
    const ts = Number(s.ts ?? 0);
    if (!Number.isFinite(ts)) return false;
    return Math.abs(ts - sourceTs) <= windowMs;
  });

  const path = input.path ?? undefined;
  const dealIdFromPath = path ? getDealIdFromPath(path) : null;
  const enrichedContext = [
    ...(state.lastAction
      ? [{ ...state.lastAction, type: "lastAction" }]
      : []),
    ...(dealIdFromPath ? [{ type: "deal.context", dealId: dealIdFromPath, path }] : []),
    ...contextSignals,
  ];

  const finding: BuddyFinding = {
    id: `finding_${now()}`,
    createdAt: now(),
    runId: state.runId ?? null,
    kind: input.kind,
    severity: input.severity ?? "n/a",
    note: input.note,
    path: input.path,
    sourceSignalTs: sourceTs,
    contextSignals: enrichedContext,
  };

  return { ...state, findings: [...(state.findings ?? []), finding] };
}

export type { BuddyFinding, FindingKind, FindingSeverity };

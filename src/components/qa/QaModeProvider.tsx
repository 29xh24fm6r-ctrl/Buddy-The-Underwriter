"use client";

import * as React from "react";

const QA_STORAGE_KEY = "buddy.qa_mode";
const QA_SESSION_KEY = "buddy.qa_session_id";

type QaContextValue = {
  enabled: boolean;
  sessionId: string;
};

const QaModeContext = React.createContext<QaContextValue | null>(null);

function getSessionId() {
  if (typeof window === "undefined") return "";
  const existing = window.localStorage.getItem(QA_SESSION_KEY);
  if (existing) return existing;
  const created = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(QA_SESSION_KEY, created);
  return created;
}

function readQaModeFromUrl() {
  if (typeof window === "undefined") return null as null | boolean;
  const params = new URLSearchParams(window.location.search);
  const value = params.get("qa");
  if (value === null) return null;
  if (value === "1" || value === "true" || value === "on") return true;
  if (value === "0" || value === "false" || value === "off") return false;
  return null;
}

function readQaModeFromStorage() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(QA_STORAGE_KEY) === "1";
}

function writeQaModeToStorage(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(QA_STORAGE_KEY, enabled ? "1" : "0");
}

export function useQaMode() {
  const ctx = React.useContext(QaModeContext);
  if (!ctx) throw new Error("useQaMode must be used within QaModeProvider");
  return ctx;
}

export function QaModeProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = React.useState(false);
  const [sessionId, setSessionId] = React.useState("");

  React.useEffect(() => {
    const envEnabled = process.env.NEXT_PUBLIC_QA_MODE === "1";
    const urlOverride = readQaModeFromUrl();
    const stored = readQaModeFromStorage();
    const nextEnabled = urlOverride ?? (envEnabled || stored);

    setEnabled(nextEnabled);
    writeQaModeToStorage(nextEnabled);
    setSessionId(getSessionId());
  }, []);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    if (enabled) {
      document.body.dataset.qaMode = "1";
    } else {
      delete document.body.dataset.qaMode;
    }
  }, [enabled]);

  React.useEffect(() => {
    if (!enabled) return;
    let lastSentAt = 0;

    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-qa-ignore='1']")) return;

      const now = Date.now();
      if (now - lastSentAt < 150) return;
      lastSentAt = now;

      const el = target.closest("button, a, input, select, textarea, [role='button']") || target;
      if (!el) return;

      const payload = {
        ts: new Date().toISOString(),
        path: window.location.pathname + window.location.search,
        element: {
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          classes: el.className || null,
          name: (el as HTMLInputElement).name || null,
          type: (el as HTMLInputElement).type || null,
          text: (el as HTMLElement).innerText?.slice(0, 120) || null,
          ariaLabel: el.getAttribute("aria-label"),
          testId: el.getAttribute("data-testid"),
          qaId: el.getAttribute("data-qa"),
          href: (el as HTMLAnchorElement).href || null,
        },
      };

      window.fetch("/api/qa/clicks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-qa-mode": "1",
        },
        body: JSON.stringify({
          sessionId,
          payload,
        }),
        keepalive: true,
      }).catch(() => null);
    };

    window.addEventListener("click", handler, { capture: true });
    return () => window.removeEventListener("click", handler, { capture: true });
  }, [enabled, sessionId]);

  const value = React.useMemo(() => ({ enabled, sessionId }), [enabled, sessionId]);

  return (
    <QaModeContext.Provider value={value}>
      {children}
      {enabled ? <QaOverlayBadge sessionId={sessionId} /> : null}
    </QaModeContext.Provider>
  );
}

function QaOverlayBadge({ sessionId }: { sessionId: string }) {
  return (
    <div
      data-qa-ignore="1"
      className="fixed top-3 right-3 z-[3000] rounded-full border border-white/20 bg-black/80 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-200 shadow-lg"
    >
      QA MODE · {sessionId.slice(0, 8)}
    </div>
  );
}

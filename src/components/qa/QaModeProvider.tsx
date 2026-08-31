"use client";

import * as React from "react";
import { sanitizeQaClickCapture } from "@/lib/qaClickTelemetry";

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
  const created =
    window.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(QA_SESSION_KEY, created);
  return created;
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
    const deploymentEnabled = process.env.NEXT_PUBLIC_QA_MODE === "1";
    setEnabled(deploymentEnabled);
    setSessionId(deploymentEnabled ? getSessionId() : "");
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
    if (!enabled || !sessionId) return;
    let lastSentAt = 0;

    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || target.closest("[data-qa-ignore='1']")) return;

      const now = Date.now();
      if (now - lastSentAt < 150) return;
      lastSentAt = now;

      const element =
        (target.closest(
          "button, a, input, select, textarea, [role='button']",
        ) as HTMLElement | null) ?? target;

      const capture = sanitizeQaClickCapture({
        sessionId,
        payload: {
          path: window.location.pathname,
          element: {
            tag: element.tagName.toLowerCase(),
            testId: element.getAttribute("data-testid"),
            qaId: element.getAttribute("data-qa"),
          },
        },
      });
      if (!capture) return;

      window
        .fetch("/api/qa/clicks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(capture),
          keepalive: true,
        })
        .catch(() => null);
    };

    window.addEventListener("click", handler, { capture: true });
    return () => window.removeEventListener("click", handler, { capture: true });
  }, [enabled, sessionId]);

  const value = React.useMemo(
    () => ({ enabled, sessionId }),
    [enabled, sessionId],
  );

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

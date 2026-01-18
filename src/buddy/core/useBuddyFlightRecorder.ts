// src/buddy/core/useBuddyFlightRecorder.ts
"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { emitBuddySignal } from "@/buddy/emitBuddySignal";

export function useBuddyFlightRecorder(opts: { enabled: boolean; runId: string | null }) {
  const { enabled, runId } = opts;
  const pathname = usePathname();

  useEffect(() => {
    if (!enabled) return;

    const onError = (event: ErrorEvent) => {
      emitBuddySignal({
        type: "error",
        source: "window.onerror",
        payload: {
          runId,
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      emitBuddySignal({
        type: "error",
        source: "window.onunhandledrejection",
        payload: {
          runId,
          reason: String(event.reason ?? "unknown"),
        },
      });
    };

    const onClickCapture = (evt: MouseEvent) => {
      const el = evt.target as HTMLElement | null;
      if (!el) return;
      const target = el.closest?.("[data-testid],[data-buddy-action],button,a") as HTMLElement | null;
      if (!target) return;

      const testid = target.getAttribute("data-testid");
      const action = target.getAttribute("data-buddy-action");
      const tag = target.tagName?.toLowerCase();
      const text = (target.textContent ?? "").trim().slice(0, 80);

      if (!testid && !action && tag !== "button" && tag !== "a") return;

      emitBuddySignal({
        type: "user.action",
        source: "flightRecorder.click",
        payload: {
          runId,
          testid: testid ?? undefined,
          action: action ?? undefined,
          tag,
          text: text || undefined,
          href: (target as HTMLAnchorElement).href ?? undefined,
          path: window.location.pathname,
        },
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("click", onClickCapture, true);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("click", onClickCapture, true);
    };
  }, [enabled, runId]);

  useEffect(() => {
    if (!enabled) return;
    emitBuddySignal({
      type: "page.ready",
      source: "flightRecorder.route",
      payload: { runId, path: pathname },
    });
  }, [enabled, pathname, runId]);
}

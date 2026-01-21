// src/buddy/core/useBuddyFlightRecorder.ts
"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { emitBuddySignal } from "@/buddy/emitBuddySignal";
import { getDealIdFromPath } from "@/buddy/getDealIdFromPath";

export function useBuddyFlightRecorder(opts: { enabled: boolean; runId: string | null }) {
  const { enabled, runId } = opts;
  const pathname = usePathname();

  useEffect(() => {
    if (!enabled) return;

    const onError = (event: ErrorEvent) => {
      const dealId = getDealIdFromPath(window.location.pathname);
      emitBuddySignal({
        type: "error",
        source: "window.onerror",
        dealId,
        payload: {
          runId,
          kind: "error",
          route: window.location.pathname,
          dealId,
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const dealId = getDealIdFromPath(window.location.pathname);
      emitBuddySignal({
        type: "error",
        source: "window.onunhandledrejection",
        dealId,
        payload: {
          runId,
          kind: "error",
          route: window.location.pathname,
          dealId,
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

      const route = window.location.pathname;
      const dealId = getDealIdFromPath(route);

      emitBuddySignal({
        type: "user.action",
        source: "flightRecorder.click",
        dealId,
        payload: {
          runId,
          kind: "user.action",
          route,
          dealId,
          testid: testid ?? undefined,
          action: action ?? undefined,
          tag,
          text: text || undefined,
          href: (target as HTMLAnchorElement).href ?? undefined,
          path: route,
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
    const route = pathname;
    const dealId = getDealIdFromPath(route ?? "");
    emitBuddySignal({
      type: "page.ready",
      source: "flightRecorder.route",
      dealId,
      payload: { runId, path: pathname, kind: "page.ready", route, dealId },
    });
  }, [enabled, pathname, runId]);
}

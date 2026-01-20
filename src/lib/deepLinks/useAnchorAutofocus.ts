"use client";

import { useEffect, useState } from "react";

const FOCUSABLE_SELECTOR =
  "input, select, textarea, button, [tabindex]:not([tabindex='-1'])";

function resolveAnchor(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const fromParam = url.searchParams.get("anchor");
  const fromHash = url.hash ? url.hash.replace(/^#/, "") : "";
  const anchor = (fromParam || fromHash || "").trim();
  return anchor || null;
}

export function useAnchorAutofocus(anchorId: string | null) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!anchorId) return;
    const targetAnchor = resolveAnchor();
    if (!targetAnchor || targetAnchor !== anchorId) return;

    const el = typeof document !== "undefined" ? document.getElementById(anchorId) : null;
    if (!el) return;

    el.scrollIntoView({ block: "start", behavior: "smooth" });

    const focusable = el.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusable) {
      try {
        focusable.focus({ preventScroll: true });
      } catch {
        focusable.focus();
      }
    }

    setActive(true);
    const timeout = window.setTimeout(() => setActive(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [anchorId]);

  return active;
}

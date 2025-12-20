"use client";

import * as React from "react";
import type { FixTarget, FixTargetKind } from "@/lib/fixTargets";

type Anchor = {
  kind: FixTargetKind;
  el: HTMLElement;
  focusMap?: Record<string, string>; // focusKey -> selector
};

type Ctx = {
  register: (kind: FixTargetKind, el: HTMLElement, focusMap?: Record<string, string>) => () => void;
  jumpTo: (t: FixTarget) => void;
  setActiveIssue: (issue: any | null) => void;
  activeIssue: any | null;
};

const FixModeContext = React.createContext<Ctx | null>(null);

export function useFixMode() {
  const ctx = React.useContext(FixModeContext);
  if (!ctx) throw new Error("useFixMode must be used within FixModeProvider");
  return ctx;
}

function highlight(el: HTMLElement) {
  el.setAttribute("data-fix-highlight", "1");
  el.classList.add("ring-2", "ring-offset-2", "ring-blue-500");
  window.setTimeout(() => {
    el.removeAttribute("data-fix-highlight");
    el.classList.remove("ring-2", "ring-offset-2", "ring-blue-500");
  }, 1800);
}

export function FixModeProvider(props: { children: React.ReactNode }) {
  const anchorsRef = React.useRef<Map<FixTargetKind, Anchor>>(new Map());
  const [activeIssue, setActiveIssue] = React.useState<any | null>(null);

  const register = React.useCallback((kind: FixTargetKind, el: HTMLElement, focusMap?: Record<string, string>) => {
    anchorsRef.current.set(kind, { kind, el, focusMap });
    return () => {
      const cur = anchorsRef.current.get(kind);
      if (cur?.el === el) anchorsRef.current.delete(kind);
    };
  }, []);

  const jumpTo = React.useCallback((t: FixTarget) => {
    const anchor = anchorsRef.current.get(t.kind);
    if (!anchor?.el) return;

    // Scroll into view
    anchor.el.scrollIntoView({ behavior: "smooth", block: "start" });

    // Highlight the card container
    highlight(anchor.el);

    // Optional: focus a specific field inside the anchor
    if (t.focus && anchor.focusMap?.[t.focus]) {
      const sel = anchor.focusMap[t.focus];
      window.setTimeout(() => {
        const field = anchor.el.querySelector(sel) as HTMLElement | null;
        if (field) {
          highlight(field);
          // focus if possible
          (field as any).focus?.();
          // if input, select contents
          if ((field as any).select) (field as any).select();
        }
      }, 350);
    }
  }, []);

  const value: Ctx = React.useMemo(
    () => ({ register, jumpTo, activeIssue, setActiveIssue }),
    [register, jumpTo, activeIssue]
  );

  return <FixModeContext.Provider value={value}>{props.children}</FixModeContext.Provider>;
}

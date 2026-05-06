"use client";

import type { ReactNode } from "react";

/**
 * Native <details> disclosure that hides admin / advanced surfaces by default.
 * Closed-by-default semantics are part of SPEC-02; tests assert
 * `open` is not present on render.
 */
export function AdvancedDisclosure({
  title = "Advanced",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <details
      data-testid="advanced-disclosure"
      className="group rounded-xl border border-white/10 bg-white/[0.02]"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-semibold uppercase tracking-widest text-white/50 hover:text-white/80">
        <span className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px]">tune</span>
          {title}
        </span>
        <span className="material-symbols-outlined text-[16px] transition-transform group-open:rotate-180">
          expand_more
        </span>
      </summary>
      <div className="space-y-3 border-t border-white/10 p-4">{children}</div>
    </details>
  );
}

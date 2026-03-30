"use client";

import { cn } from "@/lib/utils";

const glassPanel =
  "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)]";

/**
 * Phase 67: Permission isolation wrapper for supplemental panels.
 * Renders a local "Access restricted" or "Not available" message
 * instead of propagating errors to parent components.
 *
 * Panel-level permission failures NEVER create phantom document blockers.
 */
export function PanelAccessWarning({ panelName }: { panelName: string }) {
  return (
    <div className={cn(glassPanel, "overflow-hidden")}>
      <div className="px-4 py-3 flex items-center gap-2">
        <span className="material-symbols-outlined text-white/20 text-[16px]">lock</span>
        <span className="text-xs text-white/40">
          {panelName}: Access restricted for this panel
        </span>
      </div>
    </div>
  );
}

export function PanelUnavailable({ panelName }: { panelName: string }) {
  return (
    <div className={cn(glassPanel, "overflow-hidden")}>
      <div className="px-4 py-3 flex items-center gap-2">
        <span className="material-symbols-outlined text-white/20 text-[16px]">info</span>
        <span className="text-xs text-white/40">
          {panelName}: Not available
        </span>
      </div>
    </div>
  );
}

/**
 * Utility for supplemental panel data fetches.
 * Returns { data, error, status } — panels check status to render
 * PanelAccessWarning/PanelUnavailable instead of crashing.
 */
export async function safePanelFetch<T>(url: string): Promise<{
  data: T | null;
  error: string | null;
  status: number | null;
}> {
  try {
    const res = await fetch(url);
    if (res.status === 403) {
      return { data: null, error: "Access restricted", status: 403 };
    }
    if (res.status === 404) {
      return { data: null, error: "Not available", status: 404 };
    }
    if (!res.ok) {
      return { data: null, error: `Fetch failed (${res.status})`, status: res.status };
    }
    const data = await res.json();
    return { data, error: null, status: res.status };
  } catch {
    return { data: null, error: "Network error", status: null };
  }
}

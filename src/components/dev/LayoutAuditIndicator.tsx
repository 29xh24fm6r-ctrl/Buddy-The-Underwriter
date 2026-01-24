"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

/**
 * Layout Audit Indicator - Dev-only component
 * Shows the current route's layout status and whether it uses GlassShell
 */

type LayoutStatus = "glass" | "stitch" | "unknown" | "mixed";

interface RouteAudit {
  pattern: RegExp | string;
  status: LayoutStatus;
  notes?: string;
}

// Route audit registry - keep in sync with docs/build-logs/layout-audit.md
const ROUTE_AUDIT: RouteAudit[] = [
  // OK - GlassShell routes
  { pattern: /^\/portfolio$/, status: "glass", notes: "Converted to GlassShell" },
  { pattern: /^\/documents$/, status: "glass", notes: "Converted to GlassShell" },
  { pattern: /^\/servicing$/, status: "glass", notes: "Converted to GlassShell" },
  { pattern: /^\/admin$/, status: "glass", notes: "Converted to GlassShell" },
  { pattern: /^\/credit-memo$/, status: "glass", notes: "Converted to GlassShell" },
  { pattern: /^\/analytics$/, status: "glass", notes: "Converted to GlassShell" },
  { pattern: /^\/deals$/, status: "glass", notes: "Uses GlassCard, dark bg" },
  { pattern: /^\/home$/, status: "glass", notes: "CommandBridgeShell, glass-styled" },

  // OK - Stitch routes (iframe)
  { pattern: /^\/deals\/[^/]+\/command$/, status: "stitch", notes: "Uses StitchPanel" },
  { pattern: /^\/deals\/[^/]+\/underwrite$/, status: "stitch", notes: "Uses StitchSurface" },
  { pattern: /^\/deals\/[^/]+\/committee$/, status: "stitch", notes: "Uses StitchSurface" },
  { pattern: /^\/intake$/, status: "stitch", notes: "Uses StitchSurface" },
  { pattern: /^\/borrower\/portal$/, status: "stitch", notes: "Uses StitchSurface" },

  // OK - Deal cockpit (custom glass panels)
  { pattern: /^\/deals\/[^/]+\/cockpit$/, status: "glass", notes: "Custom glass panels" },

  // Unknown/needs review
  { pattern: /^\/deals\/new$/, status: "unknown", notes: "Client component - check styling" },
];

function getRouteStatus(pathname: string): { status: LayoutStatus; notes: string } {
  for (const audit of ROUTE_AUDIT) {
    const matches = typeof audit.pattern === "string"
      ? pathname === audit.pattern
      : audit.pattern.test(pathname);

    if (matches) {
      return { status: audit.status, notes: audit.notes || "" };
    }
  }
  return { status: "unknown", notes: "Not in audit registry" };
}

export function LayoutAuditIndicator() {
  const pathname = usePathname();
  const [isExpanded, setIsExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Only show in development
  if (process.env.NODE_ENV !== "development" || !mounted || !pathname) {
    return null;
  }

  const { status, notes } = getRouteStatus(pathname);

  const statusColors: Record<LayoutStatus, string> = {
    glass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    stitch: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    mixed: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    unknown: "bg-red-500/20 text-red-300 border-red-500/30",
  };

  const statusIcons: Record<LayoutStatus, string> = {
    glass: "blur_on",
    stitch: "web",
    mixed: "warning",
    unknown: "help",
  };

  return (
    <div className="fixed bottom-4 left-4 z-[9999] font-sans">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur transition-all ${statusColors[status]}`}
      >
        <span className="material-symbols-outlined text-[16px]">
          {statusIcons[status]}
        </span>
        <span className="uppercase">{status}</span>
        <span className="material-symbols-outlined text-[14px]">
          {isExpanded ? "expand_more" : "expand_less"}
        </span>
      </button>

      {isExpanded && (
        <div className="absolute bottom-full left-0 mb-2 w-80 rounded-xl border border-white/10 bg-black/90 p-4 text-sm text-white/80 backdrop-blur shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-semibold text-white">Layout Audit</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${statusColors[status]}`}>
              {status}
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div>
              <span className="text-white/50">Route:</span>{" "}
              <span className="font-mono text-white/90">{pathname}</span>
            </div>
            <div>
              <span className="text-white/50">Notes:</span>{" "}
              <span className="text-white/70">{notes}</span>
            </div>
          </div>

          <div className="mt-4 border-t border-white/10 pt-3">
            <div className="text-[10px] text-white/40 uppercase tracking-wider mb-2">Legend</div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                <span>GlassShell</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
                <span>Stitch iframe</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                <span>Mixed layout</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                <span>Needs audit</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LayoutAuditIndicator;

"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { usePathname } from "next/navigation";

type DemoState = "empty" | "converging" | "ready" | "blocked";

export function DemoControlPanel() {
  const [isOpen, setIsOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const pathname = usePathname();

  // Only show in non-production
  if (typeof window !== "undefined" && window.location.hostname.includes("vercel.app")) {
    return null;
  }

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const copyLink = (state: DemoState) => {
    const url = new URL(window.location.href);
    url.searchParams.set("__mode", "demo");
    url.searchParams.set("__state", state);
    
    navigator.clipboard.writeText(url.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currentDemoState = React.useMemo(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get("__mode") === "demo") {
      return params.get("__state") ?? "converging";
    }
    return null;
  }, []);

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-4 left-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-purple-600 text-white shadow-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-600"
        title="Demo Controls"
      >
        <Icon name="rocket_launch" className="h-5 w-5 text-white" />
      </button>

      {/* Demo state indicator */}
      {currentDemoState && (
        <div className="fixed left-20 bottom-4 z-50 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
          Demo: {currentDemoState}
        </div>
      )}

      {/* Control panel */}
      {isOpen && (
        <div className="fixed left-4 bottom-20 z-50 w-80 rounded-xl border border-neutral-200 bg-white p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon name="rocket_launch" className="h-5 w-5 text-purple-600" />
              <div className="text-sm font-semibold">Demo Controls</div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="rounded p-1 hover:bg-neutral-100"
            >
              <Icon name="remove" className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-3 text-xs text-neutral-600">
            Copy demo links to showcase different states
          </div>

          <div className="space-y-2">
            {(["empty", "converging", "ready", "blocked"] as DemoState[]).map((state) => (
              <button
                key={state}
                onClick={() => copyLink(state)}
                className="flex w-full items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-left text-sm hover:bg-neutral-50"
              >
                <span className="font-medium capitalize">{state}</span>
                <Icon name="file" className="h-4 w-4 text-neutral-500" />
              </button>
            ))}
          </div>

          {copied && (
            <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              ✓ Link copied to clipboard
            </div>
          )}

          <div className="mt-3 text-xs text-neutral-500">
            Links include <code>?__mode=demo&__state=...</code>
          </div>
        </div>
      )}
    </>
  );
}

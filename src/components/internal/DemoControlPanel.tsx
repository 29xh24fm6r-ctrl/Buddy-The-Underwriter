"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";

type DemoState = "working" | "waiting" | "done";

export function DemoControlPanel() {
  const [isOpen, setIsOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [customMessage, setCustomMessage] = React.useState("");

  const copyLink = (state: DemoState, message?: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("__mode", "demo");
    url.searchParams.set("__state", state);
    if (message) {
      url.searchParams.set("__message", message);
    }
    
    navigator.clipboard.writeText(url.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shouldHide = React.useMemo(() => {
    // Never show in production builds
    if (process.env.NODE_ENV === "production") return true;
    // Hide on hosted preview deployments
    if (typeof window !== "undefined" && window.location.hostname.includes("vercel.app")) {
      return true;
    }
    return false;
  }, []);

  const currentDemoState = React.useMemo(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get("__mode") === "demo") {
      return {
        state: params.get("__state") ?? "working",
        message: params.get("__message"),
      };
    }
    return null;
  }, []);

  if (shouldHide) return null;

  const presetMessages = {
    working: "Analyzing tax returns with OCR...",
    waiting: "Waiting on borrower to upload personal tax returns",
    done: "All documents received and analysis complete",
  };

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
          🎬 Demo Mode: {currentDemoState.state}
          {currentDemoState.message && (
            <div className="mt-0.5 text-purple-200 text-[10px]">
              {currentDemoState.message.slice(0, 40)}...
            </div>
          )}
        </div>
      )}

      {/* Control panel */}
      {isOpen && (
        <div className="fixed left-4 bottom-20 z-50 w-96 rounded-xl border border-neutral-200 bg-white p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon name="rocket_launch" className="h-5 w-5 text-purple-600" />
              <div className="text-sm font-semibold">Demo Mode Controls</div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="rounded p-1 hover:bg-neutral-100"
            >
              <Icon name="remove" className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-3 rounded-lg bg-purple-50 px-3 py-2 text-xs text-purple-900">
            📌 Override pipeline state for sales demos
          </div>

          <div className="space-y-3">
            {/* Preset states */}
            {(["working", "waiting", "done"] as DemoState[]).map((state) => (
              <div key={state} className="space-y-1">
                <button
                  onClick={() => copyLink(state, presetMessages[state])}
                  className="flex w-full items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-left text-sm hover:bg-neutral-50"
                >
                  <div>
                    <div className="font-medium capitalize">{state}</div>
                    <div className="text-xs text-neutral-500">
                      {presetMessages[state].slice(0, 35)}...
                    </div>
                  </div>
                  <Icon name="file" className="h-4 w-4 text-neutral-500" />
                </button>
              </div>
            ))}

            {/* Custom message input */}
            <div className="border-t border-neutral-200 pt-3 space-y-2">
              <label className="text-xs font-medium text-neutral-700">
                Custom Message:
              </label>
              <input
                type="text"
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="e.g., Analyzing financial statements..."
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
              />
              <div className="flex gap-2">
                {(["working", "waiting", "done"] as DemoState[]).map((state) => (
                  <button
                    key={`custom-${state}`}
                    onClick={() => copyLink(state, customMessage)}
                    disabled={!customMessage}
                    className="flex-1 rounded-lg border border-purple-200 bg-purple-50 px-2 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {state}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {copied && (
            <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              ✓ Demo link copied to clipboard
            </div>
          )}

          <div className="mt-3 text-xs text-neutral-500">
            Links include ?__mode=demo&__state=...&__message=...
          </div>
        </div>
      )}
    </>
  );
}

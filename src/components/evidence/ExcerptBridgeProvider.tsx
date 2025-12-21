// src/components/evidence/ExcerptBridgeProvider.tsx
"use client";

import React, { useEffect } from "react";
import { registerOpenExcerptDispatcher, type OpenExcerptArgs } from "@/lib/evidence/excerpts/openExcerpt";

/**
 * Simple excerpt modal provider
 * Opens a modal with excerpt details when openExcerpt() is called
 * 
 * TODO: Wire this to your actual excerpt modal/overlay system
 * For now, shows a simple modal with the excerpt data
 */
export function ExcerptBridgeProvider({ children }: { children: React.ReactNode }) {
  const [excerpt, setExcerpt] = React.useState<OpenExcerptArgs | null>(null);

  useEffect(() => {
    registerOpenExcerptDispatcher((args: OpenExcerptArgs) => {
      setExcerpt(args);
    });
  }, []);

  return (
    <>
      {children}
      
      {/* Simple excerpt modal */}
      {excerpt && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setExcerpt(null)}
        >
          <div 
            className="w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Evidence Excerpt</h2>
              <button
                onClick={() => setExcerpt(null)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <div className="text-xs text-slate-300">Deal ID</div>
                <div className="text-white font-mono">{excerpt.dealId}</div>
              </div>

              <div>
                <div className="text-xs text-slate-300">File ID</div>
                <div className="text-white font-mono">{excerpt.fileId}</div>
              </div>

              <div>
                <div className="text-xs text-slate-300">Character Range</div>
                <div className="text-white">{excerpt.globalCharStart} → {excerpt.globalCharEnd}</div>
              </div>

              {excerpt.citationId && (
                <div>
                  <div className="text-xs text-slate-300">Citation ID</div>
                  <div className="text-white font-mono">{excerpt.citationId}</div>
                </div>
              )}

              {excerpt.source && (
                <div>
                  <div className="text-xs text-slate-300">Source</div>
                  <div className="text-white">{excerpt.source}</div>
                </div>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-white/10">
              <p className="text-xs text-slate-300 mb-3">
                TODO: Wire this modal to your actual excerpt viewer with PDF overlay, text highlighting, etc.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => window.location.href = `/deals/${excerpt.dealId}`}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
                >
                  Open Deal →
                </button>
                <button
                  onClick={() => setExcerpt(null)}
                  className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

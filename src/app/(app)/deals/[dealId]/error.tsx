"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function DealError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    console.error("[DealError]", error);
  }, [error]);

  const sha = process.env.NEXT_PUBLIC_GIT_SHA?.slice(0, 7) ?? "dev";

  const diagnostics = [
    `error: ${error.message}`,
    error.digest ? `digest: ${error.digest}` : null,
    `build: ${sha}`,
    `url: ${typeof window !== "undefined" ? window.location.href : "unknown"}`,
    `time: ${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join("\n");

  function copyDiagnostics() {
    navigator.clipboard.writeText(diagnostics).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="min-h-[50vh] flex items-center justify-center px-6">
      <div className="max-w-md w-full space-y-5">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 border border-red-500/20">
          <span className="material-symbols-outlined text-red-400 text-2xl">error</span>
        </div>

        <div className="text-center">
          <h1 className="text-xl font-bold text-white">Deal unavailable</h1>
          <p className="mt-2 text-sm text-white/60">
            Could not load this deal. The server may be temporarily unavailable.
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/30 p-4 space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-white/40">Diagnostics</div>
          <div className="font-mono text-xs text-white/70 whitespace-pre-line break-all">
            {diagnostics}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 justify-center">
          <button
            onClick={() => reset()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
          >
            Try again
          </button>
          <button
            onClick={copyDiagnostics}
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10"
          >
            {copied ? "Copied" : "Copy diagnostics"}
          </button>
          <Link
            href="/deals"
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10"
          >
            Back to Deals
          </Link>
        </div>
      </div>
    </div>
  );
}

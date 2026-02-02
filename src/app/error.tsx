"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  const sha = process.env.NEXT_PUBLIC_GIT_SHA?.slice(0, 7) ?? "dev";
  const env = process.env.NEXT_PUBLIC_BUILD_ENV ?? "unknown";

  const diagnostics = [
    `error: ${error.message}`,
    error.digest ? `digest: ${error.digest}` : null,
    `build: ${sha}`,
    `env: ${env}`,
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
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0a0a0f] text-white">
        <div className="mx-auto max-w-md px-6 py-16 space-y-5">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 border border-red-500/20">
            <span className="material-symbols-outlined text-red-400 text-2xl">error</span>
          </div>

          <div className="text-center">
            <h1 className="text-xl font-bold">Something went wrong</h1>
            <p className="mt-2 text-sm text-white/60">
              Buddy hit an unexpected error. This is usually temporary.
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
              className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
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
              href="/"
              className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10"
            >
              Go home
            </Link>
          </div>

          <div className="text-center text-[10px] text-white/30 font-mono">
            Build {sha} · {env}
          </div>
        </div>
      </body>
    </html>
  );
}

"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[app/error.tsx]", error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg-dark text-white">
        <div className="mx-auto max-w-2xl px-6 py-16">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="mt-3 text-white/70">
            The app hit an unexpected error. This is not your fault.
          </p>

          <div className="mt-6 rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="text-sm text-white/60">Error</div>
            <div className="mt-1 font-mono text-xs text-white/80">
              {error.message}
              {error.digest ? ` (digest: ${error.digest})` : null}
            </div>
          </div>

          <div className="mt-8 flex gap-3">
            <button
              className="rounded-xl bg-white/10 px-4 py-2 hover:bg-white/15"
              onClick={() => reset()}
            >
              Try again
            </button>
            <a
              className="rounded-xl bg-white/10 px-4 py-2 hover:bg-white/15"
              href="/"
            >
              Go home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}

"use client";

import React from "react";
import Link from "next/link";

export class StitchErrorBoundary extends React.Component<
  { children: React.ReactNode; title?: string },
  { hasError: boolean; error?: Error }
> {
  state = { hasError: false, error: undefined as Error | undefined };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
     
    console.error("[StitchErrorBoundary]", error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <h2 className="text-xl font-semibold">This page failed to render</h2>
        <p className="mt-2 text-white/70">
          {this.props.title ? `"${this.props.title}"` : "A Stitch page"} hit a runtime error.
        </p>
        <div className="mt-6 rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="text-sm text-white/60">Error</div>
          <div className="mt-1 font-mono text-xs text-white/80">
            {this.state.error?.message}
          </div>
        </div>
        <div className="mt-8 flex gap-3">
          <button
            className="rounded-xl bg-white/10 px-4 py-2 hover:bg-white/15"
            onClick={() => this.setState({ hasError: false, error: undefined })}
          >
            Try again
          </button>
          <Link className="rounded-xl bg-white/10 px-4 py-2 hover:bg-white/15"  href="/deals">
            Back to Deals
          </Link>
        </div>
      </div>
    );
  }
}

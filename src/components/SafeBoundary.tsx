"use client";

import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

/**
 * 🔥 BANK-GRADE ERROR BOUNDARY
 * 
 * Prevents React crashes from propagating to users.
 * Wraps risky components (file uploads, checklist rendering, etc.)
 * 
 * Usage:
 * <SafeBoundary>
 *   <ChecklistCard dealId={dealId} />
 * </SafeBoundary>
 */
export class SafeBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[SafeBoundary] Caught error:", error, errorInfo);
    
    // TODO: Send to error tracking service (Sentry, etc.)
    // logErrorToService(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="rounded-xl border border-red-800 bg-red-950/20 p-6">
          <div className="flex items-start gap-3">
            <div className="shrink-0 text-2xl">⚠️</div>
            <div className="flex-1">
              <div className="font-semibold text-red-200">Something went wrong</div>
              <div className="mt-1 text-sm text-red-300">
                This component encountered an error. We're working on it. Try refreshing the page.
              </div>
              {this.state.error && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-red-400 hover:text-red-300">
                    Technical details
                  </summary>
                  <pre className="mt-2 overflow-auto rounded-lg bg-red-950/40 p-3 text-xs text-red-300">
                    {this.state.error.message}
                    {this.state.error.stack && `\n\n${this.state.error.stack}`}
                  </pre>
                </details>
              )}
              <button
                onClick={() => window.location.reload()}
                className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
              >
                Refresh Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * 🔥 PROCESSING STATE COMPONENT
 * 
 * Shows when async operations are in progress.
 * Prevents users from seeing broken/incomplete UI.
 */
export function ProcessingState({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-6">
      <div className="flex items-center gap-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-600 border-t-white" />
        <div className="text-sm text-neutral-300">{label}</div>
      </div>
    </div>
  );
}

/**
 * 🔥 ERROR PANEL COMPONENT
 * 
 * Shows when something fails gracefully.
 */
export function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-amber-800 bg-amber-950/20 p-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0 text-xl">⚠️</div>
        <div className="flex-1">
          <div className="font-semibold text-amber-200">Notice</div>
          <div className="mt-1 text-sm text-amber-300">{message}</div>
        </div>
      </div>
    </div>
  );
}

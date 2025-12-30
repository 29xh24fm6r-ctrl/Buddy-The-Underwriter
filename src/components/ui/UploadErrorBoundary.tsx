"use client";

import React from "react";
import { Icon } from "@/components/ui/Icon";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Enterprise-grade error boundary for upload-heavy areas.
 * Prevents one upload bug from nuking the entire Deal Cockpit.
 * 
 * Usage:
 * <UploadErrorBoundary>
 *   <UploadBox />
 * </UploadErrorBoundary>
 */
export class UploadErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[UploadErrorBoundary] caught error", {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="rounded-xl border border-red-800 bg-red-950/20 p-6">
          <div className="flex items-start gap-3">
            <Icon name="error" className="h-6 w-6 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-red-300 mb-1">
                Upload Error
              </h3>
              <p className="text-sm text-red-400/90 mb-3">
                {this.state.error?.message || "An upload error occurred"}
              </p>
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="text-xs font-medium text-red-300 hover:text-red-200 underline"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

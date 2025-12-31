"use client";

import React from "react";
import { Icon } from "@/components/ui/Icon";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  context?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * General-purpose React error boundary
 * Prevents component crashes from propagating to parent
 * 
 * Usage:
 * <ErrorBoundary context="UploadBox">
 *   <UploadBox />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const context = this.props.context || "UI";
    console.error(`[ui-error] ${context}:`, {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
    });

    this.setState({ errorInfo });
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const context = this.props.context || "section";

      return (
        <div className="rounded-xl border border-red-800 bg-red-950/20 p-6">
          <div className="flex items-start gap-3">
            <Icon name="error" className="h-6 w-6 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-red-300 mb-1">
                Error in {context}
              </h3>
              <p className="text-sm text-red-400/90 mb-3">
                {this.state.error?.message || "An unexpected error occurred"}
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={this.handleReload}
                  className="text-xs font-medium text-red-300 hover:text-red-200 underline"
                >
                  Reload section
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="text-xs font-medium text-red-400/70 hover:text-red-300 underline"
                >
                  Reload page
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

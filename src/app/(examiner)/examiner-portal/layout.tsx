/**
 * Examiner Portal Layout.
 *
 * Minimal chrome for scoped examiner access.
 * No sidebar, no navigation — single-purpose, read-only.
 * Grant ID is passed via query parameter.
 */
"use client";

import React from "react";

export default function ExaminerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex items-center justify-between max-w-5xl mx-auto">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-gray-900">
              Examiner Portal
            </h1>
            <span className="text-[10px] bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded border border-yellow-200">
              Read-Only
            </span>
          </div>
          <span className="text-[10px] text-gray-400">
            Scoped Access — All activity is logged
          </span>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 py-6">{children}</main>
    </div>
  );
}

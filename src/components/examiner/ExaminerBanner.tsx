/**
 * ExaminerBanner - Read-only mode indicator
 * 
 * Displays at top of page when in examiner mode.
 * Indicates that the view is snapshot-locked and no mutations are allowed.
 */
"use client";

export function ExaminerBanner() {
  return (
    <div className="sticky top-0 z-50 border-b border-yellow-300 bg-yellow-50 px-4 py-2 shadow-sm">
      <div className="mx-auto max-w-7xl flex items-center gap-2">
        <svg
          className="h-4 w-4 text-yellow-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
        <span className="text-sm font-medium text-yellow-900">
          Examiner Mode — Read-only snapshot view
        </span>
        <span className="ml-auto text-xs text-yellow-700">
          This is a locked historical view. No actions are permitted.
        </span>
      </div>
    </div>
  );
}

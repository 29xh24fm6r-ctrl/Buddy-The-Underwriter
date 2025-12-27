/**
 * SBA Progress Tracker Component
 * 
 * Shows borrower:
 * - Overall progress bar (% of required facts gathered)
 * - Next 3 easiest tasks
 * - Document upload checklist
 * - Estimated time to completion
 */

"use client";

import { CheckCircle2, Circle, Clock, FileText, AlertCircle } from "lucide-react";

interface ProgressTask {
  label: string;
  status: "complete" | "in-progress" | "pending";
  priority: "HIGH" | "MEDIUM" | "LOW";
  estimatedMins?: number;
}

interface SBAProgressTrackerProps {
  progressPct: number;
  tasks: ProgressTask[];
  missingFacts?: string[];
  nextCriticalFact?: { fact: string; question: string };
}

export function SBAProgressTracker({
  progressPct,
  tasks,
  missingFacts = [],
  nextCriticalFact,
}: SBAProgressTrackerProps) {
  const completeTasks = tasks.filter((t) => t.status === "complete").length;
  const totalTasks = tasks.length;
  const estimatedTime = tasks
    .filter((t) => t.status !== "complete")
    .reduce((sum, t) => sum + (t.estimatedMins || 5), 0);

  return (
    <div className="bg-white rounded-lg border shadow-sm p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">
          Your SBA Application Progress
        </h3>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Clock className="h-4 w-4" />
          <span>~{estimatedTime} mins remaining</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            {completeTasks} of {totalTasks} tasks complete
          </span>
          <span className="text-sm font-semibold text-blue-600">
            {Math.round(progressPct)}%
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
          <div
            className="bg-gradient-to-r from-blue-500 to-green-500 h-full transition-all duration-500 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Next Critical Question */}
      {nextCriticalFact && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-900 mb-1">
                Next Important Question:
              </p>
              <p className="text-sm text-blue-800">{nextCriticalFact.question}</p>
            </div>
          </div>
        </div>
      )}

      {/* Task List */}
      <div className="space-y-3">
        {tasks.slice(0, 5).map((task, idx) => (
          <div
            key={idx}
            className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
              task.status === "complete"
                ? "bg-green-50 border-green-200"
                : task.status === "in-progress"
                ? "bg-blue-50 border-blue-200"
                : "bg-gray-50 border-gray-200 hover:bg-gray-100"
            }`}
          >
            {task.status === "complete" ? (
              <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
            ) : (
              <Circle className="h-5 w-5 text-gray-400 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p
                  className={`text-sm font-medium ${
                    task.status === "complete"
                      ? "text-green-900 line-through"
                      : "text-gray-900"
                  }`}
                >
                  {task.label}
                </p>
                {task.priority === "HIGH" && task.status !== "complete" && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
                    High Priority
                  </span>
                )}
              </div>
              {task.estimatedMins && task.status !== "complete" && (
                <p className="text-xs text-gray-600">~{task.estimatedMins} mins</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Missing Facts Warning */}
      {missingFacts.length > 0 && (
        <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm font-medium text-yellow-900 mb-2">
            Still need information about:
          </p>
          <ul className="list-disc list-inside space-y-1">
            {missingFacts.slice(0, 3).map((fact, idx) => (
              <li key={idx} className="text-sm text-yellow-800">
                {fact.replace(/_/g, " ").replace(/\./g, " › ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

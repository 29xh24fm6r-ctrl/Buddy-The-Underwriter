"use client";

export type Condition = {
  id: string;
  title: string;
  description?: string;
  severity: "REQUIRED" | "IMPORTANT" | "FYI";
  source: "SBA" | "BANK" | "AI" | "REGULATORY";
  satisfied: boolean;
  ai_explanation?: string;
  last_evaluated_at?: string;
};

export type ConditionsSummary = {
  total: number;
  satisfied: number;
  remaining: number;
  required: number;
  required_satisfied: number;
  required_remaining: number;
  completion_pct: number;
  ready: boolean;
};

export default function ConditionsCard({
  conditions,
  summary,
}: {
  conditions: Condition[];
  summary?: ConditionsSummary;
}) {
  if (!conditions || conditions.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-6">
        <h2 className="text-lg font-semibold mb-2">Conditions to Close</h2>
        <p className="text-gray-500 text-sm">No conditions defined for this application.</p>
      </div>
    );
  }

  const requiredConditions = conditions.filter((c) => c.severity === "REQUIRED");
  const importantConditions = conditions.filter((c) => c.severity === "IMPORTANT");
  const fyiConditions = conditions.filter((c) => c.severity === "FYI");

  return (
    <div className="rounded-lg border bg-white p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Conditions to Close</h2>
        {summary && (
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-2xl font-bold text-gray-900">
                {summary.completion_pct}%
              </div>
              <div className="text-xs text-gray-500">Complete</div>
            </div>
            {summary.ready ? (
              <div className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                ✓ Ready
              </div>
            ) : (
              <div className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-medium">
                {summary.required_remaining} Required
              </div>
            )}
          </div>
        )}
      </div>

      {/* Summary Stats */}
      {summary && (
        <div className="grid grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
          <div>
            <div className="text-sm text-gray-600">Total</div>
            <div className="text-xl font-semibold">
              {summary.satisfied}/{summary.total}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600">Required</div>
            <div className="text-xl font-semibold">
              {summary.required_satisfied}/{summary.required}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600">Remaining</div>
            <div className="text-xl font-semibold text-yellow-600">
              {summary.remaining}
            </div>
          </div>
        </div>
      )}

      {/* Required Conditions */}
      {requiredConditions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700 uppercase">
            Required ({requiredConditions.filter((c) => c.satisfied).length}/
            {requiredConditions.length})
          </h3>
          <div className="space-y-2">
            {requiredConditions.map((c) => (
              <ConditionItem key={c.id} condition={c} />
            ))}
          </div>
        </div>
      )}

      {/* Important Conditions */}
      {importantConditions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700 uppercase">
            Important ({importantConditions.filter((c) => c.satisfied).length}/
            {importantConditions.length})
          </h3>
          <div className="space-y-2">
            {importantConditions.map((c) => (
              <ConditionItem key={c.id} condition={c} />
            ))}
          </div>
        </div>
      )}

      {/* FYI Conditions */}
      {fyiConditions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700 uppercase">
            FYI ({fyiConditions.filter((c) => c.satisfied).length}/{fyiConditions.length})
          </h3>
          <div className="space-y-2">
            {fyiConditions.map((c) => (
              <ConditionItem key={c.id} condition={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ConditionItem({ condition }: { condition: Condition }) {
  const bgColor = condition.satisfied
    ? "bg-green-50 border-green-200"
    : condition.severity === "REQUIRED"
    ? "bg-red-50 border-red-200"
    : condition.severity === "IMPORTANT"
    ? "bg-yellow-50 border-yellow-200"
    : "bg-blue-50 border-blue-200";

  const icon = condition.satisfied ? "✓" : condition.severity === "REQUIRED" ? "!" : "i";

  return (
    <div className={`rounded-lg p-4 border ${bgColor}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg font-semibold">{icon}</span>
            <span className="font-medium text-gray-900">{condition.title}</span>
            <span className="text-xs px-2 py-0.5 bg-white rounded border text-gray-600">
              {condition.source}
            </span>
          </div>

          {condition.description && (
            <p className="text-sm text-gray-700 mb-2">{condition.description}</p>
          )}

          {condition.ai_explanation && (
            <div className="mt-2 p-2 bg-white/50 rounded border border-gray-200">
              <p className="text-xs text-gray-600">
                <span className="font-semibold">🤖 Buddy:</span>{" "}
                {condition.ai_explanation}
              </p>
            </div>
          )}

          {condition.last_evaluated_at && (
            <p className="text-xs text-gray-500 mt-2">
              Last checked: {new Date(condition.last_evaluated_at).toLocaleString()}
            </p>
          )}
        </div>

        <div>
          {condition.satisfied ? (
            <div className="px-2 py-1 bg-green-600 text-white rounded text-xs font-medium">
              Satisfied
            </div>
          ) : (
            <div className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs font-medium">
              Outstanding
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

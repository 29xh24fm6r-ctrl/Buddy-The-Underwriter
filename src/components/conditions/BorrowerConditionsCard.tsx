"use client";

export type BorrowerCondition = {
  id: string;
  title: string;
  description?: string;
  severity: "REQUIRED" | "IMPORTANT" | "FYI";
  ai_explanation?: string;
};

export default function BorrowerConditionsCard({
  conditions,
  completionPct,
}: {
  conditions: BorrowerCondition[];
  completionPct: number;
}) {
  // Only show unsatisfied conditions to borrowers
  const outstandingConditions = conditions.filter((c) => c.severity !== "FYI");

  if (outstandingConditions.length === 0) {
    return (
      <div className="rounded-lg border-2 border-green-500 bg-green-50 p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="text-4xl">🎉</div>
          <div>
            <h2 className="text-xl font-semibold text-green-900">
              All Set!
            </h2>
            <p className="text-green-700">
              You've completed all required items. We're reviewing your application now.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white p-6 space-y-4">
      {/* Progress Header */}
      <div className="pb-4 border-b">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Items Needed to Move Forward
        </h2>
        <p className="text-gray-600 mb-3">
          To keep your SBA loan moving forward, we need a few more items from you.
        </p>
        <div className="flex items-center gap-3">
          <div className="flex-1 bg-gray-200 rounded-full h-3">
            <div
              className="bg-blue-600 h-3 rounded-full transition-all"
              style={{ width: `${completionPct}%` }}
            />
          </div>
          <div className="text-sm font-semibold text-gray-700">
            {completionPct}%
          </div>
        </div>
      </div>

      {/* Outstanding Items */}
      <div className="space-y-3">
        {outstandingConditions.map((condition, index) => (
          <div
            key={condition.id}
            className={`rounded-lg p-4 border-2 ${
              condition.severity === "REQUIRED"
                ? "border-red-300 bg-red-50"
                : "border-yellow-300 bg-yellow-50"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold ${
                    condition.severity === "REQUIRED" ? "bg-red-600" : "bg-yellow-600"
                  }`}
                >
                  {index + 1}
                </div>
              </div>

              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-gray-900">{condition.title}</h3>
                  {condition.severity === "REQUIRED" && (
                    <span className="text-xs px-2 py-0.5 bg-red-600 text-white rounded">
                      Required
                    </span>
                  )}
                </div>

                {condition.description && (
                  <p className="text-sm text-gray-700 mb-2">{condition.description}</p>
                )}

                {condition.ai_explanation && (
                  <div className="mt-2 p-3 bg-white rounded-lg border border-gray-200">
                    <p className="text-sm text-gray-700">{condition.ai_explanation}</p>
                  </div>
                )}

                <button className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors">
                  Upload Document
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Help Section */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-start gap-3">
          <div className="text-2xl">💡</div>
          <div className="flex-1">
            <h3 className="font-semibold text-blue-900 mb-1">Need Help?</h3>
            <p className="text-sm text-blue-800">
              If you have questions about any of these items, click the chat icon in the
              bottom right to talk with our team. We're here to help!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

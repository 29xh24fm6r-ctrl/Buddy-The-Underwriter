/**
 * /deals/[dealId]/decision/overrides - Override management UI with governance controls
 */
"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

export default function OverridesPage() {
  const params = useParams();
  const dealId = params.dealId as string;
  const [overrides, setOverrides] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // New override form state
  const [fieldPath, setFieldPath] = useState("");
  const [oldValue, setOldValue] = useState("");
  const [newValue, setNewValue] = useState("");
  const [reason, setReason] = useState("");
  const [justification, setJustification] = useState("");
  const [requiresReview, setRequiresReview] = useState(false);

  const loadOverrides = React.useCallback(async () => {
    const res = await fetch(`/api/deals/${dealId}/overrides`);
    const data = await res.json();
    if (data.ok) {
      setOverrides(data.overrides || []);
    }
    setLoading(false);
  }, [dealId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOverrides();
  }, [dealId]);

  async function submit() {
    await fetch(`/api/deals/${dealId}/overrides`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "current-user", // TODO: Get from auth
        field_path: fieldPath,
        old_value: oldValue,
        new_value: newValue,
        reason,
        justification: justification || null,
        requires_review: requiresReview,
        severity: requiresReview ? "material" : "normal",
      }),
    });
    
    // Reset form
    setFieldPath("");
    setOldValue("");
    setNewValue("");
    setReason("");
    setJustification("");
    setRequiresReview(false);
    
    // Reload
    loadOverrides();
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-gray-600">Loading overrides...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Decision Overrides</h1>
      <p className="text-gray-600">
        Human overrides applied to automated decision logic ({overrides.length} total)
      </p>

      {/* Create Override Form */}
      <div className="border rounded-lg p-4 space-y-3 bg-gray-50">
        <h3 className="font-semibold">Create New Override</h3>
        <div className="grid gap-3 lg:grid-cols-2">
          <input
            type="text"
            placeholder="Field path (e.g., credit_score)"
            value={fieldPath}
            onChange={(e) => setFieldPath(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Old value"
            value={oldValue}
            onChange={(e) => setOldValue(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="New value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm"
          />
        </div>
        <textarea
          placeholder="Justification (optional)"
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          className="rounded-xl border px-3 py-2 text-sm w-full"
          rows={2}
        />
        
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={requiresReview}
            onChange={(e) => setRequiresReview(e.target.checked)}
          />
          Requires review (material override)
        </label>

        <button
          className="rounded-xl border px-3 py-2 text-sm hover:bg-muted"
          onClick={submit}
          disabled={!fieldPath || !oldValue || !newValue || !reason}
        >
          Create Override
        </button>
      </div>

      {/* Overrides List */}
      {overrides.length === 0 ? (
        <div className="border rounded-lg p-8 text-center text-gray-500">
          No overrides applied to this deal
        </div>
      ) : (
        <div className="space-y-4">
          {overrides.map((ov: any) => (
            <div
              key={ov.id}
              className={`border rounded-lg p-4 ${
                ov.severity === "critical"
                  ? "border-red-300 bg-red-50"
                  : ov.severity === "material" || ov.severity === "high"
                    ? "border-orange-300 bg-orange-50"
                    : "bg-white"
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="font-semibold">{ov.field_path}</div>
                <div className="flex gap-2">
                  <div
                    className={`text-xs px-2 py-1 rounded ${
                      ov.severity === "critical"
                        ? "bg-red-200 text-red-800"
                        : ov.severity === "material" || ov.severity === "high"
                          ? "bg-orange-200 text-orange-800"
                          : "bg-gray-200 text-gray-800"
                    }`}
                  >
                    {ov.severity || "normal"}
                  </div>
                  {ov.requires_review && (
                    <div className="text-xs px-2 py-1 rounded bg-purple-200 text-purple-800">
                      Needs Review
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-2 text-sm">
                <div>
                  <span className="text-gray-600">Old:</span> {ov.old_value}
                </div>
                <div>
                  <span className="text-gray-600">New:</span> {ov.new_value}
                </div>
              </div>

              <div className="text-sm text-gray-700 mb-1">
                <span className="font-medium">Reason:</span> {ov.reason}
              </div>

              {ov.justification && (
                <div className="text-sm text-gray-600">
                  <span className="font-medium">Justification:</span> {ov.justification}
                </div>
              )}

              <div className="text-xs text-gray-400 mt-2">
                {new Date(ov.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useEffect, useState } from "react";

type ConditionItem = {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  badgeColor: string;
  explanation: string;
  itemsNeeded: string[];
  examples: string[];
  severity: string | null;
  linkedDocCount: number;
  canUpload: boolean;
};

type NextStep = {
  nextConditionId: string | null;
  nextConditionTitle: string | null;
  reason: string | null;
  counts: {
    total: number;
    completed: number;
    remaining: number;
    pending: number;
    submitted: number;
    underReview: number;
  };
};

const BADGE_CLASSES: Record<string, string> = {
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-amber-100 text-amber-700",
  emerald: "bg-emerald-100 text-emerald-700",
  red: "bg-red-100 text-red-700",
  purple: "bg-purple-100 text-purple-700",
};

export default function BorrowerConditionsCard({ token }: { token?: string }) {
  const [conditions, setConditions] = useState<ConditionItem[]>([]);
  const [nextStep, setNextStep] = useState<NextStep | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadConditions = async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/portal/${token}/conditions`, { cache: "no-store" });
      const data = await res.json();
      if (data?.ok) {
        setConditions(data.conditions ?? []);
        setNextStep(data.nextStep ?? null);
        setError(null);
      } else {
        setError(data?.error ?? "Failed to load conditions");
      }
    } catch {
      setError("Unable to load conditions. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadConditions(); }, [token]);

  if (loading) {
    return (
      <div className="border rounded-lg p-4 animate-pulse bg-white">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-gray-100 rounded" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-amber-200 rounded-lg p-4 bg-amber-50">
        <p className="text-sm text-amber-800">{error}</p>
      </div>
    );
  }

  if (!token || conditions.length === 0) {
    return (
      <div className="border rounded-lg p-4 bg-white text-gray-600 text-sm">
        No conditions found yet. Your underwriter will let you know when documents are needed.
      </div>
    );
  }

  const outstanding = conditions.filter((c) => c.canUpload);
  const completed = conditions.filter((c) => !c.canUpload);
  const counts = nextStep?.counts;

  return (
    <div className="space-y-4">
      {/* Progress Summary */}
      {counts && counts.total > 0 && (
        <div className="border rounded-lg p-4 bg-white">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Your Progress</span>
            <span className="text-sm text-gray-600">
              {counts.completed} of {counts.total} complete
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-emerald-500 h-2 rounded-full transition-all"
              style={{ width: `${counts.total ? Math.round((counts.completed / counts.total) * 100) : 0}%` }}
            />
          </div>
          {nextStep?.nextConditionTitle && (
            <div className="mt-3 text-xs text-gray-600">
              <span className="font-medium">Next step:</span> {nextStep.nextConditionTitle}
              {nextStep.reason && <span className="text-gray-400"> — {nextStep.reason}</span>}
            </div>
          )}
        </div>
      )}

      {/* Outstanding Conditions */}
      {outstanding.length > 0 && (
        <div className="border rounded-lg bg-white overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50">
            <h3 className="font-semibold text-sm">Items Needed ({outstanding.length})</h3>
          </div>
          <div className="divide-y">
            {outstanding.map((c) => (
              <ConditionCard key={c.id} condition={c} token={token} onUploadComplete={loadConditions} />
            ))}
          </div>
        </div>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <details className="border rounded-lg bg-white overflow-hidden">
          <summary className="px-4 py-3 bg-gray-50 font-semibold text-sm cursor-pointer">
            Completed ({completed.length})
          </summary>
          <div className="divide-y">
            {completed.map((c) => (
              <div key={c.id} className="px-4 py-3 flex items-center gap-2">
                <span className="text-emerald-600">&#10003;</span>
                <span className="text-sm text-gray-600">{c.title}</span>
                <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${BADGE_CLASSES[c.badgeColor] ?? BADGE_CLASSES.gray}`}>
                  {c.statusLabel}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function ConditionCard({
  condition,
  token,
  onUploadComplete,
}: {
  condition: ConditionItem;
  token: string;
  onUploadComplete: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);

    try {
      // 1. Get signed upload URL
      const signRes = await fetch(`/api/borrower/portal/${token}/files/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          content_type: file.type,
          size_bytes: file.size,
        }),
      });
      const signData = await signRes.json();
      if (!signRes.ok || !signData?.url) {
        throw new Error(signData?.error ?? "Failed to get upload URL");
      }

      // 2. Upload file bytes
      await fetch(signData.url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      // 3. Record via condition-targeted route
      const recordRes = await fetch(`/api/portal/${token}/conditions/${condition.id}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: signData.file_id ?? signData.fileId,
          object_path: signData.object_path ?? signData.storagePath,
          storage_path: signData.storage_path ?? signData.storagePath,
          storage_bucket: signData.storage_bucket ?? signData.bucket,
          original_filename: file.name,
          mime_type: file.type,
          size_bytes: file.size,
        }),
      });
      const recordData = await recordRes.json();
      if (!recordRes.ok || !recordData?.ok) {
        throw new Error(recordData?.error ?? "Failed to record upload");
      }

      onUploadComplete();
    } catch (err: any) {
      setUploadError(err?.message ?? "Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm">{condition.title}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${BADGE_CLASSES[condition.badgeColor] ?? BADGE_CLASSES.gray}`}>
              {condition.statusLabel}
            </span>
          </div>
          <p className="text-xs text-gray-600 mb-2">{condition.explanation}</p>
          {condition.itemsNeeded.length > 0 && (
            <ul className="text-xs text-gray-500 space-y-0.5 mb-2">
              {condition.itemsNeeded.map((item, i) => (
                <li key={i}>&#8226; {item}</li>
              ))}
            </ul>
          )}
          {condition.examples.length > 0 && (
            <div className="text-xs text-gray-400">
              Examples: {condition.examples.join(", ")}
            </div>
          )}
          {condition.linkedDocCount > 0 && (
            <div className="text-xs text-blue-600 mt-1">
              {condition.linkedDocCount} document{condition.linkedDocCount !== 1 ? "s" : ""} uploaded
            </div>
          )}
        </div>
        <div className="shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleUpload}
            disabled={uploading}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-3 py-1.5 bg-gray-900 text-white text-xs rounded hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>
      </div>
      {uploadError && (
        <div className="mt-2 text-xs text-red-600 bg-red-50 rounded px-2 py-1">
          {uploadError}
        </div>
      )}
    </div>
  );
}

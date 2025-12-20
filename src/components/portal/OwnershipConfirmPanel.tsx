"use client";

import * as React from "react";
import { VoiceCaptureBar } from "@/components/portal/VoiceCaptureBar";

type FindingsData = {
  ok: boolean;
  proposed: Array<{
    id: string;
    fullName: string;
    ownershipPercent: number | null;
    confidenceTag: string;
    evidenceLabel: string | null;
    evidencePage: number | null;
    evidenceSnippet: string | null;
  }>;
  confirmed: Array<{
    id: string;
    fullName: string;
    ownershipPercent: number | null;
    requiresPersonalPackage: boolean;
  }>;
  coverage: {
    totalPercent: number;
    status: string;
    message: string;
  };
};

export function OwnershipConfirmPanel(props: { dealId: string; onComplete?: () => void }) {
  const [data, setData] = React.useState<FindingsData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const [showFix, setShowFix] = React.useState(false);
  const [fixText, setFixText] = React.useState("");

  async function load() {
    setError(null);
    try {
      const token = localStorage.getItem("buddy_invite_token");
      if (!token) throw new Error("No invite token found");

      const res = await fetch(`/api/portal/deals/${props.dealId}/ownership/findings`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to load ownership");
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    }
  }

  React.useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.dealId]);

  async function confirmAll() {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("buddy_invite_token");
      if (!token) throw new Error("No invite token found");

      const res = await fetch(`/api/portal/deals/${props.dealId}/ownership/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "confirm_all" }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to confirm");

      await load();
      props.onComplete?.();
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function confirmOne(findingId: string) {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("buddy_invite_token");
      if (!token) throw new Error("No invite token found");

      const res = await fetch(`/api/portal/deals/${props.dealId}/ownership/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "confirm_one", findingId }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to confirm");

      await load();
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function rejectOne(findingId: string) {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("buddy_invite_token");
      if (!token) throw new Error("No invite token found");

      const res = await fetch(`/api/portal/deals/${props.dealId}/ownership/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "reject_one", findingId }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to reject");

      await load();
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function submitCorrection() {
    if (!fixText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("buddy_invite_token");
      if (!token) throw new Error("No invite token found");

      const res = await fetch(`/api/portal/deals/${props.dealId}/ownership/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "correct_text", text: fixText }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to correct");

      // Live evidence highlight: re-run extraction to attach evidence chips
      try {
        await fetch(`/api/portal/deals/${props.dealId}/ownership/refresh`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        });
      } catch {
        // ignore refresh errors
      }

      setFixText("");
      setShowFix(false);
      await load();
      props.onComplete?.();
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  if (error) {
    return (
      <div className="rounded-2xl border bg-white p-5">
        <div className="text-sm text-red-700">{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border bg-white p-5">
        <div className="text-sm text-gray-600">Loading ownership details…</div>
      </div>
    );
  }

  const hasProposed = data.proposed.length > 0;
  const hasConfirmed = data.confirmed.length > 0;

  return (
    <div className="space-y-4">
      {/* Coverage banner */}
      {hasConfirmed && (
        <div
          className={`rounded-2xl border p-5 ${
            data.coverage.status === "complete" ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"
          }`}
        >
          <div className="text-sm font-semibold">{data.coverage.message}</div>
          <div className="mt-1 text-xs text-gray-600">{data.coverage.totalPercent}% ownership assigned</div>
        </div>
      )}

      {/* Confirmed owners */}
      {hasConfirmed && (
        <div className="rounded-2xl border bg-white p-5">
          <div className="text-base font-semibold">Confirmed owners</div>
          <div className="mt-3 space-y-2">
            {data.confirmed.map((owner) => (
              <div key={owner.id} className="rounded-xl border bg-gray-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{owner.fullName}</div>
                    {owner.ownershipPercent !== null && (
                      <div className="mt-1 text-sm text-gray-600">{owner.ownershipPercent}% ownership</div>
                    )}
                  </div>
                  {owner.requiresPersonalPackage && (
                    <span className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium">
                      Personal docs needed
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Proposed findings (AI-extracted) */}
      {hasProposed && (
        <div className="rounded-2xl border bg-white p-5">
          <div className="text-base font-semibold">We found ownership in your documents</div>
          <div className="mt-1 text-sm text-gray-600">Please confirm or correct below.</div>

          <div className="mt-4 space-y-3">
            {data.proposed.map((finding) => (
              <div key={finding.id} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold">{finding.fullName}</div>
                      <ConfidenceBadge tag={finding.confidenceTag} />
                    </div>
                    {finding.ownershipPercent !== null && (
                      <div className="mt-1 text-sm text-gray-700">{finding.ownershipPercent}% ownership</div>
                    )}
                    {finding.evidenceLabel && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <div className="rounded-md border bg-gray-50 px-2 py-1 text-xs text-gray-600">
                          {finding.evidenceLabel}
                          {finding.evidencePage ? ` p.${finding.evidencePage}` : ""}
                        </div>
                      </div>
                    )}
                    {finding.evidenceSnippet && (
                      <div className="mt-2 rounded-lg border bg-gray-50 p-2 text-xs text-gray-600">
                        "{finding.evidenceSnippet}…"
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                      onClick={() => confirmOne(finding.id)}
                      disabled={loading}
                    >
                      ✓ Confirm
                    </button>
                    <button
                      className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                      onClick={() => rejectOne(finding.id)}
                      disabled={loading}
                    >
                      ✕ Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex gap-3">
            <button
              className="h-11 rounded-md border px-4 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              onClick={confirmAll}
              disabled={loading}
            >
              ✓ Confirm all
            </button>
            <button
              className="h-11 rounded-md border px-4 text-sm hover:bg-gray-50"
              onClick={() => setShowFix(!showFix)}
            >
              ✏️ Fix / Add owners
            </button>
          </div>
        </div>
      )}

      {/* Manual correction box */}
      {(showFix || (!hasProposed && !hasConfirmed)) && (
        <div className="rounded-2xl border bg-white p-5">
          <div className="text-base font-semibold">Enter ownership</div>
          <div className="mt-1 text-sm text-gray-600">Use natural language. Examples:</div>
          <div className="mt-2 space-y-1 text-xs text-gray-500">
            <div>• "Me 60%, John Smith 25%, Sarah Jones 15%"</div>
            <div>• "Matt 55, John 25, Sarah 20"</div>
            <div>• "I'm 51%, spouse 49%"</div>
            <div>• "Add Mike Johnson, 10%, mike@example.com"</div>
          </div>

          <VoiceCaptureBar
            value={fixText}
            onChange={setFixText}
            placeholder="Say or type: Matt 55, John 25, Sarah 20"
          />

          <div className="mt-3 flex gap-2">
            <button
              className="h-11 rounded-md border px-4 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              onClick={submitCorrection}
              disabled={loading || !fixText.trim()}
            >
              Submit
            </button>
            {showFix && (
              <button className="h-11 rounded-md border px-4 text-sm hover:bg-gray-50" onClick={() => setShowFix(false)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ConfidenceBadge(props: { tag: string }) {
  const colors = {
    High: "bg-green-100 text-green-700 border-green-200",
    Medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
    Low: "bg-gray-100 text-gray-600 border-gray-200",
  };
  const cls = colors[props.tag as keyof typeof colors] ?? colors.Low;

  return <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{props.tag}</span>;
}

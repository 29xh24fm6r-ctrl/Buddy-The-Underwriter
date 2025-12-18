"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import ConditionsCard from "@/components/conditions/ConditionsCard";

type UnderwriterData = {
  eligibility?: any;
  requirements?: any;
  forms?: any;
  preflight?: any;
  narrative?: any;
  etran?: any;
  agents?: any;
  documents?: any[];
  conditions?: any;
};

export default function UnderwriterConsolePage() {
  const params = useParams();
  const dealId = params.dealId as string;

  const [data, setData] = useState<UnderwriterData>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAll() {
      try {
        // Load all data in parallel
        const [
          eligRes,
          reqRes,
          formRes,
          preRes,
          narrRes,
          etranRes,
          agentRes,
          docRes,
          condRes,
        ] = await Promise.all([
          fetch(`/api/deals/${dealId}/eligibility`).then((r) => r.json()),
          fetch(`/api/deals/${dealId}/requirements`).then((r) => r.json()),
          fetch(`/api/deals/${dealId}/forms`).then((r) => r.json()),
          fetch(`/api/deals/${dealId}/preflight`).then((r) => r.json()),
          fetch(`/api/deals/${dealId}/narrative`).then((r) => r.json()),
          fetch(`/api/deals/${dealId}/etran/check`).then((r) => r.json()),
          fetch(`/api/deals/${dealId}/agents`).then((r) => r.json()),
          fetch(`/api/deals/${dealId}/documents`).then((r) => r.json()),
          fetch(`/api/deals/${dealId}/conditions/recompute`).then((r) => r.json()),
        ]);

        setData({
          eligibility: eligRes,
          requirements: reqRes,
          forms: formRes,
          preflight: preRes,
          narrative: narrRes,
          etran: etranRes,
          agents: agentRes,
          documents: docRes.documents || [],
          conditions: condRes,
        });
      } catch (err) {
        console.error("Failed to load underwriter data:", err);
      } finally {
        setLoading(false);
      }
    }

    loadAll();
  }, [dealId]);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse">Loading underwriter console...</div>
      </div>
    );
  }

  const score = data.preflight?.score ?? 0;
  const passed = data.preflight?.passed ?? false;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">
            SBA Underwriter Console
          </h1>
          <p className="text-gray-600">Deal ID: {dealId}</p>
        </div>

        {/* Readiness Score */}
        <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold mb-2">Readiness Score</h2>
              <div className="text-5xl font-bold text-gray-900">{score}/100</div>
              <div className="mt-2">
                {passed ? (
                  <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                    ✓ Ready
                  </span>
                ) : (
                  <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-medium">
                    ⚠ Needs Attention
                  </span>
                )}
              </div>
            </div>

            <div className="text-right">
              <p className="text-sm text-gray-600">SOP Citations</p>
              <p className="text-xs text-gray-500 mt-1">
                SOP 50 10 7.1 - Eligibility
              </p>
              <p className="text-xs text-gray-500">SOP 50 10 7.2 - Documentation</p>
            </div>
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Generated Documents */}
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h3 className="text-lg font-semibold mb-4">Generated Documents</h3>
            <div className="space-y-3">
              <DocumentItem
                title="SBA Intake Form (PDF)"
                status={data.forms?.status === "READY" ? "Ready" : "Pending"}
                onClick={() => alert("Download PDF")}
              />
              <DocumentItem
                title="Credit Memo"
                status={data.narrative ? "Ready" : "Pending"}
                onClick={() => alert("View Memo")}
              />
              <DocumentItem
                title="E-Tran XML"
                status={data.etran?.ready ? "Ready" : "Not Ready"}
                onClick={() => alert("View XML")}
              />
            </div>
          </div>

          {/* E-Tran Status */}
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h3 className="text-lg font-semibold mb-4">E-Tran Status</h3>
            <div className="space-y-3">
              <StatusRow
                label="Preflight"
                status={passed ? "Passed" : "Failed"}
                color={passed ? "green" : "red"}
              />
              <StatusRow
                label="Forms"
                status={data.forms?.status || "Pending"}
                color={data.forms?.status === "READY" ? "green" : "yellow"}
              />
              <StatusRow
                label="Documents"
                status={
                  data.requirements?.summary?.required_missing === 0
                    ? "Complete"
                    : "Incomplete"
                }
                color={
                  data.requirements?.summary?.required_missing === 0
                    ? "green"
                    : "yellow"
                }
              />
              <StatusRow
                label="Ready for Submission"
                status={data.etran?.ready ? "Yes" : "No"}
                color={data.etran?.ready ? "green" : "red"}
              />
            </div>
          </div>

          {/* Conditions to Close */}
          <div className="lg:col-span-2">
            <ConditionsCard 
              conditions={data.conditions?.conditions || []}
              summary={data.conditions?.summary}
            />
          </div>

          {/* Agent Recommendations */}
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h3 className="text-lg font-semibold mb-4">Agent Recommendations</h3>
            {data.agents?.recommendations?.length > 0 ? (
              <div className="space-y-3">
                {data.agents.recommendations.slice(0, 5).map((rec: any, i: number) => (
                  <div key={i} className="border-l-4 border-blue-500 pl-3 py-2">
                    <p className="font-medium text-sm">{rec.agent}</p>
                    <p className="text-sm text-gray-600">{rec.action}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Confidence: {Math.round(rec.confidence * 100)}%
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No recommendations</p>
            )}
          </div>

          {/* Blocking Issues */}
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h3 className="text-lg font-semibold mb-4">Blocking Issues</h3>
            {data.preflight?.blocking_issues?.length > 0 ? (
              <div className="space-y-3">
                {data.preflight.blocking_issues.map((issue: any, i: number) => (
                  <div key={i} className="border-l-4 border-red-500 pl-3 py-2">
                    <p className="font-medium text-sm text-red-800">{issue.message}</p>
                    {issue.how_to_fix && (
                      <p className="text-xs text-gray-600 mt-1">
                        Fix: {issue.how_to_fix}
                      </p>
                    )}
                    {issue.sop_citation && (
                      <p className="text-xs text-blue-600 mt-1">
                        SOP: {issue.sop_citation}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-green-600 text-sm">✓ No blocking issues</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-semibold mb-4">Actions</h3>
          <div className="flex gap-3">
            <button
              onClick={() => alert("Approve & Submit to E-Tran")}
              disabled={!data.etran?.ready}
              className={`px-6 py-3 rounded-lg font-medium ${
                data.etran?.ready
                  ? "bg-green-600 text-white hover:bg-green-700"
                  : "bg-gray-300 text-gray-500 cursor-not-allowed"
              }`}
            >
              Approve & Submit to SBA E-Tran
            </button>
            <button
              onClick={() => alert("Request Changes")}
              className="px-6 py-3 bg-yellow-600 text-white rounded-lg font-medium hover:bg-yellow-700"
            >
              Request Changes
            </button>
            <button
              onClick={() => alert("Decline Application")}
              className="px-6 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700"
            >
              Decline
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DocumentItem({
  title,
  status,
  onClick,
}: {
  title: string;
  status: string;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between p-3 border rounded hover:bg-gray-50 cursor-pointer"
    >
      <span className="text-sm font-medium">{title}</span>
      <span
        className={`text-xs px-2 py-1 rounded ${
          status === "Ready"
            ? "bg-green-100 text-green-800"
            : "bg-gray-100 text-gray-600"
        }`}
      >
        {status}
      </span>
    </div>
  );
}

function StatusRow({
  label,
  status,
  color,
}: {
  label: string;
  status: string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    green: "bg-green-100 text-green-800",
    yellow: "bg-yellow-100 text-yellow-800",
    red: "bg-red-100 text-red-800",
  };

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-700">{label}</span>
      <span className={`text-xs px-2 py-1 rounded ${colorMap[color]}`}>{status}</span>
    </div>
  );
}

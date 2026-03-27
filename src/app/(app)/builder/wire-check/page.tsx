"use client";

import { useEffect, useState } from "react";

type SurfaceEntry = {
  key: string;
  route: string;
  slug: string;
  status: string;
  integrationType: string;
  hasActivationScript: boolean;
  required: boolean;
  exportExists: boolean;
  exportSizeKb: number;
  dataDependencies: string[];
  apiCallsExpected: string[];
  writeActionsExpected: string[];
  permissionModel: string;
  successCriteria: string;
  notes: string;
};

type WiringSummary = {
  total: number;
  wired: number;
  visual: number;
  partial: number;
  broken: number;
  unverified: number;
  required: number;
  withActivation: number;
};

type HealthResponse = {
  ok: boolean;
  summary: WiringSummary;
  surfaces: SurfaceEntry[];
  exportsDirExists: boolean;
};

const STATUS_COLORS: Record<string, string> = {
  wired: "bg-emerald-100 text-emerald-800 border-emerald-300",
  visual: "bg-blue-100 text-blue-800 border-blue-300",
  partial: "bg-amber-100 text-amber-800 border-amber-300",
  broken: "bg-red-100 text-red-800 border-red-300",
  unverified: "bg-neutral-100 text-neutral-600 border-neutral-300",
};

const TYPE_LABELS: Record<string, string> = {
  read_only: "Read-only",
  read_nav: "Read + Nav",
  read_write: "Read + Write",
  token_activated: "Token-activated",
  visual_only: "Visual-only",
};

export const dynamic = "force-dynamic";

export default function WireCheckPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("token") ?? ""
      : "";

    fetch(`/api/builder/stitch/runtime-health`, {
      headers: token ? { "x-builder-token": token } : {},
    })
      .then(async (res) => {
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const json = await res.json();
        setData(json);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-white p-8">
        <h1 className="text-2xl font-bold text-neutral-900">Wire Check</h1>
        <p className="mt-2 text-neutral-500">Loading surface wiring data...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-white p-8">
        <h1 className="text-2xl font-bold text-neutral-900">Wire Check</h1>
        <p className="mt-2 text-red-600">
          Failed to load: {error ?? "Unknown error"}. Pass ?token=YOUR_BUILDER_TOKEN.
        </p>
      </div>
    );
  }

  const { summary, surfaces } = data;

  return (
    <div className="min-h-screen bg-white p-8">
      <h1 className="text-2xl font-bold text-neutral-900">Stitch Surface Wire Check</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Phase 62B — Integration status for all {summary.total} surfaces
      </p>

      {/* Summary cards */}
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <SummaryCard label="Total" value={summary.total} />
        <SummaryCard label="Required" value={summary.required} />
        <SummaryCard label="Wired" value={summary.wired} color="text-emerald-600" />
        <SummaryCard label="Visual" value={summary.visual} color="text-blue-600" />
        <SummaryCard label="Partial" value={summary.partial} color="text-amber-600" />
        <SummaryCard label="Broken" value={summary.broken} color="text-red-600" />
        <SummaryCard label="Unverified" value={summary.unverified} color="text-neutral-500" />
        <SummaryCard label="With Activation" value={summary.withActivation} color="text-violet-600" />
      </div>

      {/* Exports dir status */}
      <div className="mt-4 text-sm">
        <span className={data.exportsDirExists ? "text-emerald-600" : "text-red-600"}>
          stitch_exports/: {data.exportsDirExists ? "Available" : "MISSING"}
        </span>
      </div>

      {/* Surface table */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="py-2 pr-3">Surface</th>
              <th className="py-2 pr-3">Route</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Type</th>
              <th className="py-2 pr-3">Activation</th>
              <th className="py-2 pr-3">Export</th>
              <th className="py-2 pr-3">Dependencies</th>
              <th className="py-2 pr-3">Writes</th>
              <th className="py-2 pr-3">Notes</th>
            </tr>
          </thead>
          <tbody>
            {surfaces.map((s) => (
              <tr
                key={s.key}
                className="border-b border-neutral-100 hover:bg-neutral-50"
              >
                <td className="py-2 pr-3 font-mono text-xs">
                  {s.key}
                  {s.required && (
                    <span className="ml-1 text-[10px] text-red-500">*</span>
                  )}
                </td>
                <td className="py-2 pr-3 font-mono text-xs text-neutral-600">
                  {s.route}
                </td>
                <td className="py-2 pr-3">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      STATUS_COLORS[s.status] ?? STATUS_COLORS.unverified
                    }`}
                  >
                    {s.status}
                  </span>
                </td>
                <td className="py-2 pr-3 text-xs text-neutral-600">
                  {TYPE_LABELS[s.integrationType] ?? s.integrationType}
                </td>
                <td className="py-2 pr-3 text-xs">
                  {s.hasActivationScript ? (
                    <span className="text-emerald-600">Yes</span>
                  ) : (
                    <span className="text-neutral-400">No</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-xs">
                  {s.exportExists ? (
                    <span className="text-emerald-600">{s.exportSizeKb}KB</span>
                  ) : (
                    <span className="text-red-500">Missing</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-xs text-neutral-500">
                  {s.dataDependencies.length > 0
                    ? s.dataDependencies.join(", ")
                    : "-"}
                </td>
                <td className="py-2 pr-3 text-xs text-neutral-500">
                  {s.writeActionsExpected.length > 0
                    ? s.writeActionsExpected.join(", ")
                    : "-"}
                </td>
                <td className="py-2 pr-3 text-xs text-neutral-400 max-w-[200px] truncate">
                  {s.notes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color = "text-neutral-900",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

"use client";

import React from "react";

export default function BorrowerPackageCard({ result }: { result: any }) {
  if (!result) {
    return (
      <div className="rounded border bg-white p-4">
        <div className="text-sm font-semibold">SBA Package</div>
        <div className="mt-2 text-sm text-neutral-600">Package not generated yet</div>
      </div>
    );
  }

  const pkg = result.package;
  const readiness = result.readiness;

  return (
    <div className="rounded border bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">SBA Package Ready</div>
        <div className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
          ✅ {readiness?.readinessLevel ?? "READY"}
        </div>
      </div>

      <div className="text-xs text-neutral-600">
        Generated: {pkg?.manifest?.generated_at ? new Date(pkg.manifest.generated_at).toLocaleString() : "N/A"}
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="Total Files" value={pkg?.summary?.total_files ?? 0} />
        <Stat label="Forms" value={pkg?.manifest?.files?.forms?.length ?? 0} />
        <Stat label="Attachments" value={pkg?.manifest?.files?.attachments ?? 0} />
      </div>

      <div className="border-t pt-3">
        <div className="text-xs font-semibold text-neutral-700">Package Contents</div>
        <ul className="mt-1 text-xs text-neutral-600 space-y-1">
          <li>📄 Credit Memo & Narrative</li>
          <li>📋 SBA Form Payloads</li>
          <li>📎 {pkg?.manifest?.files?.attachments ?? 0} Supporting Documents</li>
          <li>📦 Package Manifest (JSON)</li>
        </ul>
      </div>

      {readiness?.blockers?.length > 0 && (
        <div className="border-t pt-3">
          <div className="text-xs font-semibold text-red-700">Remaining Issues</div>
          <ul className="mt-1 list-disc pl-5 text-xs text-neutral-600">
            {readiness.blockers.map((b: string, i: number) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded border p-2">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

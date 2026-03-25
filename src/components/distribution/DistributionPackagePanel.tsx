"use client";

import { useState } from "react";

type PackageStatus = "available" | "generated" | "approved" | "published" | "sent";

type PackageInfo = {
  type: "borrower" | "banker" | "relationship";
  label: string;
  status: PackageStatus;
  snapshotId?: string;
};

type Props = {
  packages: PackageInfo[];
  onGenerate?: (type: string) => void;
  onPreview?: (type: string, snapshotId?: string) => void;
  onPublish?: (type: string, snapshotId: string) => void;
};

const glass = "rounded-xl border border-white/10 bg-white/[0.03] p-4";

const STATUS_STYLES: Record<PackageStatus, { label: string; cls: string }> = {
  available: { label: "Ready to Generate", cls: "bg-white/10 text-white/50" },
  generated: { label: "Generated", cls: "bg-blue-500/20 text-blue-300" },
  approved: { label: "Approved", cls: "bg-emerald-500/20 text-emerald-300" },
  published: { label: "Published", cls: "bg-purple-500/20 text-purple-300" },
  sent: { label: "Sent", cls: "bg-emerald-500/20 text-emerald-300" },
};

const TYPE_ICONS: Record<string, string> = {
  borrower: "person",
  banker: "account_balance",
  relationship: "handshake",
};

export function DistributionPackagePanel({ packages, onGenerate, onPreview, onPublish }: Props) {
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-white">Distribution Packages</div>
      <div className="text-xs text-white/40">Generate and send approved intelligence to the right audience.</div>

      <div className="space-y-2">
        {packages.map((pkg) => {
          const statusStyle = STATUS_STYLES[pkg.status] ?? STATUS_STYLES.available;
          return (
            <div key={pkg.type} className={`${glass} flex items-center justify-between`}>
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[18px] text-white/40">
                  {TYPE_ICONS[pkg.type] ?? "package_2"}
                </span>
                <div>
                  <div className="text-sm font-medium text-white">{pkg.label}</div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusStyle.cls}`}>
                    {statusStyle.label}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {pkg.status === "available" && onGenerate && (
                  <button
                    type="button"
                    onClick={() => onGenerate(pkg.type)}
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
                  >
                    Generate
                  </button>
                )}
                {(pkg.status === "generated" || pkg.status === "approved") && onPreview && (
                  <button
                    type="button"
                    onClick={() => onPreview(pkg.type, pkg.snapshotId)}
                    className="text-xs text-primary hover:underline"
                  >
                    Preview
                  </button>
                )}
                {pkg.status === "generated" && pkg.snapshotId && onPublish && pkg.type === "borrower" && (
                  <button
                    type="button"
                    onClick={() => onPublish(pkg.type, pkg.snapshotId!)}
                    className="rounded-lg bg-purple-600/20 border border-purple-500/30 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-600/30"
                  >
                    Publish to Portal
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

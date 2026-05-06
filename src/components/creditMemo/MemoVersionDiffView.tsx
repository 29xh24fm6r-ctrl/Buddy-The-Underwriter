"use client";

import React, { useState } from "react";
import type { MemoVersionDiff } from "@/lib/creditMemo/intelligence/types";

const SEVERITY_BADGE: Record<string, string> = {
  material: "bg-rose-100 text-rose-800 border-rose-200",
  moderate: "bg-amber-100 text-amber-800 border-amber-200",
  minor: "bg-gray-100 text-gray-700 border-gray-200",
};

export default function MemoVersionDiffView({ diff }: { diff: MemoVersionDiff | null }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (!diff) {
    return (
      <section className="rounded-md border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Version Changes</h2>
        <p className="mt-1 text-xs text-gray-500 italic">
          No prior submitted version to compare. This is the first banker submission for this deal.
        </p>
      </section>
    );
  }

  const total = diff.changed_sections.length;

  return (
    <section className="rounded-md border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2 className="text-sm font-semibold text-gray-900">
          Version Changes — v{diff.from_version} → v{diff.to_version}
        </h2>
        <span className="text-[10px] font-mono text-gray-500">
          {diff.material_changes.length} material · {total} section{total === 1 ? "" : "s"} changed
        </span>
      </div>
      <p className="text-xs text-gray-700 mb-3">{diff.summary}</p>

      {total === 0 ? (
        <div className="text-[11px] text-emerald-700 italic">
          No structural differences detected.
        </div>
      ) : (
        <div className="space-y-2">
          {diff.changed_sections.map((section) => {
            const open = expanded[section.section_key] ?? false;
            const materialCount = section.changes.filter((c) => c.severity === "material").length;
            return (
              <div key={section.section_key} className="border border-gray-200 rounded">
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((prev) => ({ ...prev, [section.section_key]: !open }))
                  }
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-gray-50 text-left"
                >
                  <span className="text-xs font-semibold text-gray-900">
                    {section.section_title}
                  </span>
                  <span className="flex items-center gap-2">
                    {materialCount > 0 && (
                      <span className={`text-[10px] font-mono border rounded px-1.5 py-0.5 ${SEVERITY_BADGE.material}`}>
                        {materialCount} material
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-gray-500">
                      {section.changes.length} change{section.changes.length === 1 ? "" : "s"}
                    </span>
                    <span className="text-[10px] text-gray-400">{open ? "▴" : "▾"}</span>
                  </span>
                </button>
                {open && (
                  <div className="border-t border-gray-200 px-3 py-2 space-y-2 bg-gray-50/50">
                    {section.changes.map((change, i) => (
                      <div key={`${change.path}_${i}`} className="text-[11px]">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-mono text-gray-700">{change.path}</span>
                          <span
                            className={`text-[10px] font-mono border rounded px-1.5 py-0.5 ${SEVERITY_BADGE[change.severity] ?? SEVERITY_BADGE.minor}`}
                          >
                            {change.severity}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                          <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1 overflow-x-auto">
                            <div className="text-rose-700 font-semibold mb-0.5">before</div>
                            <div className="text-rose-900 break-all">{formatValue(change.before)}</div>
                          </div>
                          <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 overflow-x-auto">
                            <div className="text-emerald-700 font-semibold mb-0.5">after</div>
                            <div className="text-emerald-900 break-all">{formatValue(change.after)}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const json = JSON.stringify(value);
  return json.length > 200 ? `${json.slice(0, 200)}…` : json;
}

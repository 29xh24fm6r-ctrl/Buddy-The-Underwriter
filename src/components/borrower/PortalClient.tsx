"use client";

import * as React from "react";
import { PortalShell } from "@/components/borrower/PortalShell";
import { DocToolbar } from "@/components/borrower/DocToolbar";
import { Icon } from "@/components/ui/Icon";

/**
 * Replace the mocked state with your real portal data:
 * - token -> deal context
 * - list of docs + statuses
 * - active doc with pages preview
 * - extracted fields needing attention
 */
type DocStatus = "needs_input" | "ready" | "processing";

type PortalDoc = {
  id: string;
  filename: string;
  status: DocStatus;
};

type Field = {
  key: string;
  label: string;
  value: string;
  needsAttention?: boolean;
};

export function PortalClient({ token }: { token: string }) {
  // TODO: replace with real fetch call(s)
  const [docs, setDocs] = React.useState<PortalDoc[]>([
    { id: "1", filename: "2023 T-12 Statement.xlsx", status: "needs_input" },
    { id: "2", filename: "Rent Roll - Q3 2023.pdf", status: "ready" },
    { id: "3", filename: "Appraisal Report.pdf", status: "processing" },
  ]);
  const [activeId, setActiveId] = React.useState(docs[0]?.id ?? "");
  const active = docs.find((d) => d.id === activeId);

  const [fields, setFields] = React.useState<Field[]>([
    { key: "property_name", label: "Property Name", value: "Highland Park Apartments" },
    { key: "reporting_period", label: "Reporting Period", value: "Jan 1, 2023 — Dec 31, 2023" },
    { key: "gross_potential_rent", label: "Gross Potential Rent", value: "$4,200,000" },
    { key: "noi", label: "Net Operating Income", value: "$2,350,000", needsAttention: true },
  ]);

  const needsAttention = fields.filter((f) => f.needsAttention).length;
  const confirmed = fields.length - needsAttention;

  return (
    <PortalShell
      title="Buddy Portal"
      subtitle="Review extracted data and confirm your documents."
      left={
        <div className="space-y-4">
          <div className="rounded-xl border border-neutral-200 p-4">
            <button
              type="button"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              onClick={() => alert("Wire upload flow")}
            >
              <Icon name="cloud_upload" className="h-4 w-4 text-white" />
              Upload New Document
            </button>
            <p className="mt-2 text-xs text-neutral-500">PDF, Excel, Word (Max 50MB)</p>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Your Documents
            </div>
            <ul className="space-y-2">
              {docs.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(d.id)}
                    className={[
                      "w-full rounded-xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-neutral-900",
                      d.id === activeId ? "border-neutral-900 bg-neutral-50" : "border-neutral-200 hover:bg-neutral-50",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-sm font-medium">{d.filename}</div>
                      <span
                        className={[
                          "shrink-0 rounded-full px-2 py-1 text-[11px] font-medium",
                          d.status === "needs_input"
                            ? "bg-amber-100 text-amber-900"
                            : d.status === "processing"
                              ? "bg-neutral-100 text-neutral-700"
                              : "bg-emerald-100 text-emerald-900",
                        ].join(" ")}
                      >
                        {d.status === "needs_input" ? "Needs input" : d.status === "processing" ? "Processing" : "Confirmed"}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      }
      center={
        <div className="space-y-4">
          <DocToolbar
            filename={active?.filename ?? "No document selected"}
            pageLabel="Page 1 of 4"
            onPrev={() => alert("prev")}
            onNext={() => alert("next")}
            onRemove={() => alert("remove")}
            onUploadNewVersion={() => alert("upload new version")}
          />

          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
            <div className="h-[420px] rounded-lg bg-white shadow-inner">
              {/* TODO: replace with your PDF viewer; keep this container for sizing */}
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                PDF Preview (wire your viewer here)
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 p-4">
            <div className="flex items-center gap-2">
              <Icon name="auto_awesome" className="h-5 w-5 text-neutral-900" />
              <div className="text-sm font-semibold">What We Read</div>
              <div className="ml-auto text-xs text-neutral-500">Based on Buddy's analysis</div>
            </div>

            <div className="mt-4 divide-y divide-neutral-200">
              {fields.map((f) => (
                <div key={f.key} className="flex items-center gap-3 py-3">
                  <div className="w-48 shrink-0 text-sm text-neutral-600">{f.label}</div>
                  <div className="min-w-0 flex-1">
                    <input
                      className={[
                        "w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900",
                        f.needsAttention ? "border-amber-400 bg-amber-50" : "border-neutral-200 bg-white",
                      ].join(" ")}
                      value={f.value}
                      onChange={(e) => {
                        const v = e.target.value;
                        setFields((prev) =>
                          prev.map((x) => (x.key === f.key ? { ...x, value: v } : x))
                        );
                      }}
                      aria-label={f.label}
                    />
                    {f.needsAttention ? (
                      <div className="mt-1 text-xs text-amber-800">
                        Please verify this value matches the document.
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0">
                    {f.needsAttention ? (
                      <button
                        type="button"
                        onClick={() =>
                          setFields((prev) =>
                            prev.map((x) => (x.key === f.key ? { ...x, needsAttention: false } : x))
                          )
                        }
                        className="rounded-lg bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900"
                      >
                        Confirm
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-sm text-emerald-700">
                        <Icon name="check_circle" className="h-4 w-4" />
                        Looks correct
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      }
      right={
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Review & Confirm</div>
              <div className="mt-1 text-xs text-neutral-500">
                Finish confirming all documents to submit.
              </div>
            </div>
            <button
              type="button"
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              onClick={() => alert("Save & Exit")}
            >
              Save & Exit
            </button>
          </div>

          <div className="rounded-xl border border-neutral-200 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Confirmation Progress</div>
              <div className="text-sm text-neutral-700">
                {confirmed} of {fields.length} fields
              </div>
            </div>
            <div className="mt-3 h-2 w-full rounded-full bg-neutral-100">
              <div
                className="h-2 rounded-full bg-neutral-900"
                style={{ width: `${Math.round((confirmed / fields.length) * 100)}%` }}
              />
            </div>
            {needsAttention > 0 ? (
              <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                <div className="font-semibold">Fields needing attention</div>
                <div className="mt-1 text-xs">
                  Confirm highlighted fields in the center panel.
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
                <div className="font-semibold">All set</div>
                <div className="mt-1 text-xs">You can submit this document.</div>
              </div>
            )}
          </div>

          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900 disabled:opacity-60"
            disabled={needsAttention > 0}
            onClick={() => alert("Confirm & Submit Document")}
          >
            <Icon name="check_circle" className="h-5 w-5 text-white" />
            Confirm & Submit Document
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="rounded-xl border border-neutral-300 px-4 py-3 text-sm hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              onClick={() => alert("Save for later")}
            >
              Save for later
            </button>
            <button
              type="button"
              className="rounded-xl border border-neutral-300 px-4 py-3 text-sm hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              onClick={() => alert("Upload new version")}
            >
              Upload new version
            </button>
          </div>
        </div>
      }
    />
  );
}

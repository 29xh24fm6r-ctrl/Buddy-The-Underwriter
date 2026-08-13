"use client";

import { useState, useEffect, useCallback } from "react";
import { IdentityVerificationCard } from "@/components/brokerage/IdentityVerificationCard";

type OwnerStructure = "solo" | "multi" | null;

export function IntakeOwnershipStep({
  dealId,
  onContinue,
}: {
  dealId: string;
  onContinue: (data?: Record<string, unknown>) => void;
}) {
  const [structure, setStructure] = useState<OwnerStructure>(null);
  const [ownershipSaved, setOwnershipSaved] = useState(false);
  const [additionalOwners, setAdditionalOwners] = useState<
    { name: string; pct: string }[]
  >([]);

  const addOwner = useCallback(() => {
    setAdditionalOwners((prev) => [...prev, { name: "", pct: "" }]);
  }, []);

  const updateOwner = useCallback(
    (idx: number, field: "name" | "pct", value: string) => {
      setAdditionalOwners((prev) =>
        prev.map((o, i) => (i === idx ? { ...o, [field]: value } : o)),
      );
    },
    [],
  );

  const removeOwner = useCallback((idx: number) => {
    setAdditionalOwners((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const saveStructure = useCallback(
    async (s: OwnerStructure) => {
      if (!s) return;
      try {
        await fetch("/api/brokerage/concierge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            factPath: "ownership.structure",
            value: s,
          }),
          credentials: "include",
        });
      } catch {
        // non-fatal
      }
      setOwnershipSaved(true);
    },
    [],
  );

  useEffect(() => {
    if (structure === "solo") {
      void saveStructure("solo");
    }
  }, [structure, saveStructure]);

  return (
    <div className="space-y-6">
      {/* Buddy bubble */}
      <div className="flex gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-blue-500 to-brand-blue-400 text-sm font-bold text-white">
          B
        </div>
        <div className="rounded-2xl rounded-bl-md bg-slate-100 px-5 py-3.5">
          <p className="text-sm text-slate-800">
            SBA requires identity verification for every owner with 20% or more. How many owners does the business have?
          </p>
        </div>
      </div>

      {/* Structure selection */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setStructure("solo")}
          className={`w-full rounded-2xl border-[1.5px] bg-white px-6 py-5 text-left transition-all ${
            structure === "solo"
              ? "border-brand-blue-500 shadow-lg shadow-blue-100/50"
              : "border-slate-200 hover:-translate-y-0.5 hover:shadow-lg"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">👤</span>
              <div>
                <p className="text-sm font-medium text-slate-900">Just me</p>
                <p className="text-xs text-slate-500">I&apos;m the sole owner (100%)</p>
              </div>
            </div>
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full transition-all duration-300 ${
                structure === "solo"
                  ? "scale-100 bg-[#0A1F44] opacity-100"
                  : "scale-90 bg-slate-100 opacity-60"
              }`}
            >
              {structure === "solo" && (
                <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStructure("multi")}
          className={`w-full rounded-2xl border-[1.5px] bg-white px-6 py-5 text-left transition-all ${
            structure === "multi"
              ? "border-brand-blue-500 shadow-lg shadow-blue-100/50"
              : "border-slate-200 hover:-translate-y-0.5 hover:shadow-lg"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">👥</span>
              <div>
                <p className="text-sm font-medium text-slate-900">Two or more owners</p>
                <p className="text-xs text-slate-500">Each 20%+ owner will need to verify their identity</p>
              </div>
            </div>
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full transition-all duration-300 ${
                structure === "multi"
                  ? "scale-100 bg-[#0A1F44] opacity-100"
                  : "scale-90 bg-slate-100 opacity-60"
              }`}
            >
              {structure === "multi" && (
                <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </div>
        </button>
      </div>

      {/* Solo celebrate card */}
      {structure === "solo" && (
        <div className="animate-in slide-in-from-top-2 fade-in duration-300 rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
              <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-emerald-900">
                That&apos;s the simplest structure — no ownership map needed.
              </p>
              <p className="text-xs text-emerald-700 mt-0.5">
                We just need to verify your identity next.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Multi-owner path */}
      {structure === "multi" && (
        <div className="animate-in slide-in-from-top-2 fade-in duration-300 space-y-4">
          {additionalOwners.map((owner, i) => (
            <div
              key={i}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm"
            >
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-medium text-slate-700">
                  Owner {i + 2}
                </h4>
                <button
                  type="button"
                  onClick={() => removeOwner(i)}
                  className="text-xs text-slate-400 hover:text-red-500"
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <input
                  type="text"
                  value={owner.name}
                  onChange={(e) => updateOwner(i, "name", e.target.value)}
                  placeholder="Full name"
                  className="col-span-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
                />
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={owner.pct}
                    onChange={(e) => updateOwner(i, "pct", e.target.value)}
                    placeholder="%"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-7 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue-500"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                    %
                  </span>
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addOwner}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-white px-5 py-4 text-sm font-medium text-slate-500 transition-colors hover:border-brand-blue-300 hover:text-brand-blue-500"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add another owner
          </button>
        </div>
      )}

      {/* Identity verification — wait for the save so the ownership entity exists */}
      {structure && ownershipSaved && (
        <div className="animate-in slide-in-from-top-2 fade-in duration-300">
          <IdentityVerificationCard dealId={dealId} />
        </div>
      )}

      {/* Continue */}
      {structure && (
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={async () => {
              if (structure === "multi") await saveStructure("multi");
              onContinue({ structure });
            }}
            className="brand-gradient-cta rounded-2xl px-8 py-3 text-sm font-medium text-white shadow-sm hover:brightness-110"
          >
            Continue →
          </button>
        </div>
      )}
    </div>
  );
}

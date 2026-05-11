"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  MethodologyAxis,
  MethodologyAxisId,
  MethodologyChoice,
  MethodologySlate,
  MethodologyVariantId,
} from "@/lib/methodology/types";

type Props = {
  dealId: string;
  slate: MethodologySlate;
  choices: MethodologyChoice[];
  isAllDefaults: boolean;
  axes: Record<MethodologyAxisId, MethodologyAxis>;
  currentValues: Record<string, number | null>;
};

function formatValue(v: number | null): string {
  if (v === null) return "\u2014";
  if (Math.abs(v) < 100 && v % 1 !== 0) return v.toFixed(2) + "x";
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function MethodologyPickerClient(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draftSlate, setDraftSlate] = useState<MethodologySlate>(props.slate);
  const [savingAxis, setSavingAxis] = useState<MethodologyAxisId | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function saveAxis(axis: MethodologyAxisId, variant: MethodologyVariantId) {
    setSavingAxis(axis);
    setSaveError(null);
    try {
      const res = await fetch(`/api/deals/${props.dealId}/methodology`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ axis, variant }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSaveError(err.error ?? "Save failed");
        setDraftSlate((prev) => ({ ...prev, [axis]: props.slate[axis] }));
        return;
      }
      const data = await res.json();
      setDraftSlate(data.slate);
      startTransition(() => router.refresh());
    } catch (err: any) {
      setSaveError(err?.message ?? "Network error");
      setDraftSlate((prev) => ({ ...prev, [axis]: props.slate[axis] }));
    } finally {
      setSavingAxis(null);
    }
  }

  const axisIds = Object.keys(props.axes) as MethodologyAxisId[];

  return (
    <div className="space-y-6">
      {props.isAllDefaults && (
        <div className="rounded-md bg-blue-50 border border-blue-200 p-4">
          <p className="text-sm text-blue-900">
            All defaults applied &mdash; Buddy is using its conservative methodology
            for this deal. Pick a non-default variant on any axis to override.
          </p>
        </div>
      )}

      {saveError && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4">
          <p className="text-sm text-red-900">Save failed: {saveError}</p>
        </div>
      )}

      {axisIds.map((axisId) => {
        const axis = props.axes[axisId];
        const chosenVariantId = draftSlate[axisId];
        const isSaving = savingAxis === axisId;

        return (
          <section
            key={axisId}
            className="rounded-lg border border-gray-200 bg-white p-6"
          >
            <h2 className="text-lg font-semibold text-gray-900">{axis.label}</h2>
            <p className="text-sm text-gray-600 mt-1">{axis.description}</p>

            <div className="mt-4 space-y-2">
              {axis.variants.map((variant) => {
                const isChecked = chosenVariantId === variant.id;
                return (
                  <label
                    key={variant.id}
                    className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                      isChecked
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`axis-${axisId}`}
                      value={variant.id}
                      checked={isChecked}
                      disabled={isSaving || isPending}
                      onChange={() => {
                        setDraftSlate((prev) => ({ ...prev, [axisId]: variant.id }));
                        saveAxis(axisId, variant.id);
                      }}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 text-sm">
                        {variant.label}
                      </div>
                      <div className="text-xs text-gray-600 mt-1">
                        {variant.description}
                      </div>
                      <div className="text-xs text-gray-500 mt-1 italic">
                        {variant.rationale}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            {axis.affectedFactKeys.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Current values affected
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  {axis.affectedFactKeys.map((factKey) => (
                    <div key={factKey} className="text-sm">
                      <div className="text-gray-500">{factKey}</div>
                      <div className="font-medium text-gray-900">
                        {formatValue(props.currentValues[factKey] ?? null)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isSaving && (
              <div className="mt-3 text-xs text-gray-500">Saving + recomputing...</div>
            )}
          </section>
        );
      })}

      <footer className="text-xs text-gray-500 italic">
        Methodology choices are logged to the audit trail and trigger an
        automatic canonical recompute. SR 11-7 compliance: bankers select from
        Buddy&apos;s curated variant list &mdash; no free-form values permitted.
      </footer>
    </div>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  MethodologyAxis,
  MethodologyAxisId,
  MethodologyChoice,
  MethodologySlate,
  MethodologyVariantId,
} from "@/lib/methodology/types";

// ── Preview response types ────────────────────────────────────────────────

type PreviewVariantRow = {
  variantId: string;
  isCurrent: boolean;
  projectedDscr: number | null;
  projectedNcads: number | null;
  deltaDscr: number | null;
};

type PreviewResponse =
  | {
      ok: true;
      projectable: true;
      currentDscr: number | null;
      currentNcads: number | null;
      proposedAds: number;
      formType: string;
      axes: Record<string, {
        currentVariant: string;
        variants: PreviewVariantRow[];
      }>;
    }
  | {
      ok: true;
      projectable: false;
      reason: string;
    };

// ── Component ─────────────────────────────────────────────────────────────

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

  // SPEC-B4.1.3 — projection preview state
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchPreview() {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const resp = await fetch(`/api/deals/${props.dealId}/methodology/preview`);
        if (!resp.ok) {
          setPreviewError(`Preview unavailable (HTTP ${resp.status})`);
          return;
        }
        const data = await resp.json();
        if (!cancelled) setPreview(data);
      } catch (err: any) {
        if (!cancelled) setPreviewError(err?.message ?? "Preview failed");
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }
    fetchPreview();
    return () => { cancelled = true; };
  }, [props.dealId]);

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

  // Helper to get the projection row for a variant
  function getProjectionRow(axisId: string, variantId: string): PreviewVariantRow | null {
    if (!preview || !preview.projectable) return null;
    const axisPreview = preview.axes[axisId];
    if (!axisPreview) return null;
    return axisPreview.variants.find((v) => v.variantId === variantId) ?? null;
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
                const row = getProjectionRow(axisId, variant.id);

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

                      {/* SPEC-B4.1.3 — Projection preview row */}
                      <div className="mt-2 text-xs font-medium" data-testid={`projection-${axisId}-${variant.id}`}>
                        {previewLoading ? (
                          <span className="text-gray-400 font-mono">&mdash;</span>
                        ) : previewError || !preview || !preview.projectable ? (
                          <span className="text-gray-400 italic">
                            Projection unavailable
                            {preview && !preview.projectable && "reason" in preview
                              ? ` \u2014 ${preview.reason}`
                              : ""}
                          </span>
                        ) : row ? (
                          row.isCurrent ? (
                            <span className="text-gray-900">
                              Current &middot; DSCR {row.projectedDscr?.toFixed(2) ?? "\u2014"}x
                            </span>
                          ) : (
                            <span className="text-gray-900">
                              Projected DSCR {row.projectedDscr?.toFixed(2) ?? "\u2014"}x{" "}
                              <span className={
                                row.deltaDscr !== null && row.deltaDscr < 0
                                  ? "text-red-600"
                                  : row.deltaDscr !== null && row.deltaDscr > 0
                                    ? "text-green-600"
                                    : "text-gray-400"
                              }>
                                ({row.deltaDscr !== null
                                  ? (row.deltaDscr >= 0 ? "+" : "") + row.deltaDscr.toFixed(2)
                                  : "0.00"})
                              </span>
                            </span>
                          )
                        ) : null}
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

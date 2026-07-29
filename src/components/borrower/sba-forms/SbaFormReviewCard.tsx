"use client";

/**
 * SPEC-M7 ZERO-REPEAT-PREFILL-1 — borrower-facing "review your forms" card.
 *
 * Split into a fetching wrapper (SbaFormReviewCard) and a pure
 * presentational component (SbaFormReviewCardBody) so every render state
 * is testable via renderToStaticMarkup without driving useEffect — same
 * convention as GlassBoxPanel/FixCardsPanel (SPEC-M3/M4).
 *
 * Only the use-of-proceeds classification (Form 1919) is ever
 * confirm-highlighted — every other field shown is already-confirmed,
 * deterministic canonical state (SPEC-M5's registry-backed pipeline).
 */
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";

export type ReviewField = {
  key: string;
  label: string;
  value: string | number | boolean | null;
  source: "deterministic" | "structurer";
  confirmed: boolean;
};

export type BorrowerFormReview = {
  formCode: "1919" | "413";
  fields: ReviewField[];
  missingCount: number;
  isComplete: boolean;
};

export type CovenantCounts = {
  borrowerAnswered: number;
  systemAnswered: number;
  totalAnswered: number;
};

function formatValue(v: string | number | boolean | null): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString();
  return v;
}

function CovenantCounter({ counts }: { counts: CovenantCounts }) {
  return (
    <div className="mb-4 rounded-2xl border border-teal-100 bg-teal-50/60 px-4 py-3">
      <p className="text-sm text-teal-900">
        You answered <span className="font-semibold">{counts.borrowerAnswered}</span>; Buddy filled in{" "}
        <span className="font-semibold">{counts.systemAnswered}</span> more from what it already knew.
      </p>
    </div>
  );
}

function FormFieldList({
  review,
  onConfirm,
}: {
  review: BorrowerFormReview;
  onConfirm?: (fieldKeys: string[]) => void;
}) {
  const needsConfirm = review.fields.filter((f) => f.source === "structurer" && !f.confirmed);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900">Form {review.formCode}</h4>
        <span className="text-xs text-slate-500">
          {review.isComplete ? "Ready" : `${review.missingCount} field(s) still needed`}
        </span>
      </div>
      <ul className="space-y-1.5">
        {review.fields.map((f) => (
          <li
            key={f.key}
            className={
              f.source === "structurer" && !f.confirmed
                ? "flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5"
                : "flex items-center justify-between px-2.5 py-1"
            }
          >
            <span className="text-xs text-slate-600">{f.label}</span>
            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-800">
              {formatValue(f.value)}
              {f.source === "structurer" && !f.confirmed && (
                <Icon name="pending" className="h-3 w-3 text-amber-600" />
              )}
            </span>
          </li>
        ))}
      </ul>
      {needsConfirm.length > 0 && onConfirm && (
        <button
          type="button"
          onClick={() => onConfirm(needsConfirm.map((f) => f.key))}
          className="mt-3 w-full rounded-xl border border-amber-400 bg-amber-100 px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-200"
        >
          Looks right — confirm
        </button>
      )}
    </div>
  );
}

/** Pure presentational component — no fetching, no state. */
export function SbaFormReviewCardBody({
  covenant,
  reviews,
  onConfirmUseOfProceeds,
  onDownload,
}: {
  covenant: CovenantCounts | null;
  reviews: BorrowerFormReview[] | null;
  onConfirmUseOfProceeds?: () => void;
  onDownload?: (formCode: "1919" | "413") => void;
}) {
  if (!reviews) {
    return (
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h3 className="text-sm font-heading font-semibold text-slate-900">Your SBA forms</h3>
        <p className="mt-3 text-sm text-slate-500">Preparing your prefilled forms…</p>
      </section>
    );
  }

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h3 className="text-sm font-heading font-semibold text-slate-900">Your SBA forms</h3>
      <p className="mt-1 text-xs text-slate-500">
        Buddy already prefilled these from what you've told us. Anything highlighted still needs a quick look.
      </p>
      {covenant && <CovenantCounter counts={covenant} />}
      <div className="mt-3 space-y-3">
        {reviews.map((review) => (
          <div key={review.formCode}>
            <FormFieldList
              review={review}
              onConfirm={review.formCode === "1919" ? onConfirmUseOfProceeds : undefined}
            />
            {onDownload && (
              <button
                type="button"
                onClick={() => onDownload(review.formCode)}
                className="mt-2 text-xs font-medium text-teal-700 underline decoration-dotted hover:text-teal-900"
              >
                Download Form {review.formCode} (unsigned preview)
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

type FetchState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "loaded"; covenant: CovenantCounts | null; reviews: BorrowerFormReview[] };

const FORM_CODES: Array<"1919" | "413"> = ["1919", "413"];

/** Fetching wrapper — resolves both forms' reviews + the covenant counter. */
export function SbaFormReviewCard({ token, refreshKey }: { token: string; refreshKey?: number }) {
  const [state, setState] = useState<FetchState>({ phase: "loading" });

  const load = useCallback(async () => {
    setState((s) => (s.phase === "loaded" ? s : { phase: "loading" }));
    try {
      const results = await Promise.all(
        FORM_CODES.map(async (formCode) => {
          const res = await fetch(`/api/portal/${token}/sba-forms/${formCode}`, { cache: "no-store" });
          const body = await res.json();
          return res.ok && body.ok ? body : null;
        }),
      );
      const loaded = results.filter(Boolean) as Array<{ review: BorrowerFormReview; covenant: CovenantCounts }>;
      if (loaded.length === 0) {
        setState({ phase: "error" });
        return;
      }
      setState({
        phase: "loaded",
        covenant: loaded[0].covenant,
        reviews: loaded.map((l) => l.review),
      });
    } catch {
      setState({ phase: "error" });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (state.phase === "error") return null; // silent on transient failure, same as GlassBoxPanel

  const handleConfirmUseOfProceeds = async () => {
    await fetch(`/api/portal/${token}/sba-forms/1919`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fieldKey: "use_of_proceeds_categories" }),
    }).catch(() => {});
    void load();
  };

  const handleDownload = (formCode: "1919" | "413") => {
    window.open(`/api/portal/${token}/sba-forms/${formCode}?download=1`, "_blank");
  };

  return (
    <SbaFormReviewCardBody
      covenant={state.phase === "loaded" ? state.covenant : null}
      reviews={state.phase === "loaded" ? state.reviews : null}
      onConfirmUseOfProceeds={handleConfirmUseOfProceeds}
      onDownload={handleDownload}
    />
  );
}

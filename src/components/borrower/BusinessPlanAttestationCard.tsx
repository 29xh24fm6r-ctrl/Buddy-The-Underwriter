"use client";

/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — borrower-facing business-plan review +
 * attestation card. Split into a fetching wrapper
 * (BusinessPlanAttestationCard) and a pure presentational component
 * (BusinessPlanAttestationCardBody) — same convention as
 * SbaFormReviewCard/GlassBoxPanel/FixCardsPanel.
 */
import { useCallback, useEffect, useState } from "react";

export type SectionProvenance = {
  storyFields: string[];
  capturedVia: string;
  capturedAt: string;
} | null;

export type BusinessPlanAttestationState = {
  hasPackage: boolean;
  attested: boolean;
  snapshotMatchesCurrent: boolean;
  provenanceEntries: SectionProvenance[];
};

const STORY_FIELD_LABELS: Record<string, string> = {
  originStory: "your origin story",
  competitiveInsight: "what sets you apart",
  idealCustomer: "your ideal customer",
  growthStrategy: "your growth plans",
  biggestRisk: "the biggest risk you named",
  personalVision: "your personal vision",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

/** Pure presentational component — no fetching, no state. */
export function BusinessPlanAttestationCardBody({
  state,
  onConfirm,
  confirming,
}: {
  state: BusinessPlanAttestationState | null;
  onConfirm?: () => void;
  confirming?: boolean;
}) {
  if (!state) {
    return (
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h3 className="text-sm font-heading font-semibold text-slate-900">Your business plan</h3>
        <p className="mt-3 text-sm text-slate-500">Preparing your business plan…</p>
      </section>
    );
  }

  if (!state.hasPackage) {
    return null;
  }

  const needsAttestation = !state.attested || !state.snapshotMatchesCurrent;
  const withStory = state.provenanceEntries.filter((p): p is NonNullable<SectionProvenance> => p !== null);
  const usedFields = Array.from(new Set(withStory.flatMap((p) => p.storyFields)));
  const earliestCapture = withStory
    .map((p) => p.capturedAt)
    .sort()[0];

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h3 className="text-sm font-heading font-semibold text-slate-900">Your business plan</h3>
      <p className="mt-1 text-xs text-slate-500">
        Buddy drafted this from what you've shared with us. Please review it before it goes to your lender.
      </p>

      {usedFields.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          Parts of this plan draw on {usedFields.map((f) => STORY_FIELD_LABELS[f] ?? f).join(", ")}
          {earliestCapture ? ` — from what you told Buddy on ${formatDate(earliestCapture)}` : ""}.
        </p>
      )}

      {needsAttestation ? (
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirming}
          className="mt-4 w-full rounded-xl border border-teal-400 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-900 hover:bg-teal-100 disabled:opacity-50"
        >
          {confirming ? "Confirming…" : "I've reviewed this and confirm it's accurate"}
        </button>
      ) : (
        <p className="mt-4 text-xs font-medium text-teal-700">Confirmed — ready to share with your lender.</p>
      )}
    </section>
  );
}

type FetchState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "loaded"; state: BusinessPlanAttestationState };

export function BusinessPlanAttestationCard({ token, refreshKey }: { token: string; refreshKey?: number }) {
  const [fetchState, setFetchState] = useState<FetchState>({ phase: "loading" });
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/${token}/business-plan/attestation`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setFetchState({ phase: "error" });
        return;
      }
      const provenanceEntries: SectionProvenance[] = body.provenance
        ? (Object.values(body.provenance) as SectionProvenance[])
        : [];
      setFetchState({
        phase: "loaded",
        state: {
          hasPackage: Boolean(body.package),
          attested: Boolean(body.attestation?.attested),
          snapshotMatchesCurrent: Boolean(body.attestation?.snapshotMatchesCurrent),
          provenanceEntries,
        },
      });
    } catch {
      setFetchState({ phase: "error" });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (fetchState.phase === "error") return null;

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await fetch(`/api/portal/${token}/business-plan/attestation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      await load();
    } finally {
      setConfirming(false);
    }
  };

  return (
    <BusinessPlanAttestationCardBody
      state={fetchState.phase === "loaded" ? fetchState.state : null}
      onConfirm={handleConfirm}
      confirming={confirming}
    />
  );
}

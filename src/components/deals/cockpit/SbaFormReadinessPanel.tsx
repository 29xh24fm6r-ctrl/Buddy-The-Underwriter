"use client";

/**
 * SPEC S2 F-1 — SBA form readiness, shown in the Story tab. Fetches
 * directly from the 1919/413 build routes rather than the cockpit-state
 * provider (per spec addendum: don't refactor cockpit-state this sprint —
 * add a separate fetch here instead).
 */

import { useEffect, useState } from "react";

type Form1919BuildResponse = {
  ok: boolean;
  missing?: {
    section_i: string[];
    section_ii: Array<{ ownership_entity_id: string; missing: string[] }>;
    section_iii: Array<{ ownership_entity_id: string; missing: string[] }>;
  };
  triggers_form_912?: boolean;
  is_complete?: boolean;
};

type Form413BuildResponse = {
  ok: boolean;
  missing?: Array<{ ownership_entity_id: string; missing: string[] }>;
  is_complete?: boolean;
};

function countMissing1919(data: Form1919BuildResponse | null): number {
  if (!data?.missing) return 0;
  const sectionII = data.missing.section_ii.reduce((sum, p) => sum + p.missing.length, 0);
  const sectionIII = data.missing.section_iii.reduce((sum, e) => sum + e.missing.length, 0);
  return data.missing.section_i.length + sectionII + sectionIII;
}

function countMissing413(data: Form413BuildResponse | null): number {
  if (!data?.missing) return 0;
  return data.missing.reduce((sum, s) => sum + s.missing.length, 0);
}

export default function SbaFormReadinessPanel({ dealId }: { dealId: string }) {
  const [form1919, setForm1919] = useState<Form1919BuildResponse | null>(null);
  const [form413, setForm413] = useState<Form413BuildResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/deals/${dealId}/sba/forms/1919/build`)
        .then((r) => r.json())
        .catch(() => null),
      fetch(`/api/deals/${dealId}/sba/forms/413/build`)
        .then((r) => r.json())
        .catch(() => null),
    ]).then(([f1919, f413]) => {
      if (cancelled) return;
      setForm1919(f1919);
      setForm413(f413);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  const glassSection = "rounded-xl border border-white/8 bg-white/[0.02] p-4";
  const sectionLabel = "text-[10px] font-bold uppercase tracking-widest text-white/40 mb-3";

  if (loading) {
    return (
      <div className={glassSection}>
        <div className={sectionLabel}>SBA Form Readiness</div>
        <div className="h-16 rounded-lg bg-white/5 animate-pulse" />
      </div>
    );
  }

  const missing1919 = countMissing1919(form1919);
  const missing413 = countMissing413(form413);

  return (
    <div className={glassSection}>
      <div className={sectionLabel}>SBA Form Readiness</div>
      <div className="space-y-3">
        <div className="rounded-lg border border-white/8 bg-black/20 p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white/80">Form 1919 — Borrower Information</div>
              <div className="mt-0.5 text-xs text-white/40">
                {form1919?.ok
                  ? missing1919 === 0
                    ? "All fields complete"
                    : `${missing1919} field${missing1919 === 1 ? "" : "s"} missing`
                  : "Unable to load"}
              </div>
              {form1919?.triggers_form_912 ? (
                <div className="mt-1 text-xs text-amber-400">Criminal-history answer triggers Form 912</div>
              ) : null}
            </div>
            <a
              href={`/api/deals/${dealId}/sba/forms/1919/build`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white/60 hover:bg-white/10"
            >
              Details
            </a>
          </div>
          {form1919?.missing?.section_ii.map((p) =>
            p.missing.length > 0 ? (
              <div key={p.ownership_entity_id} className="mt-2 text-xs text-white/40">
                Owner {p.ownership_entity_id.slice(0, 8)}: {p.missing.join(", ")}
              </div>
            ) : null,
          )}
          <button
            type="button"
            disabled
            title="Available after identity verification (Sprint 3)"
            className="mt-3 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white/30 cursor-not-allowed"
          >
            Sign Form 1919
          </button>
        </div>

        <div className="rounded-lg border border-white/8 bg-black/20 p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white/80">Form 413 — Personal Financial Statement</div>
              <div className="mt-0.5 text-xs text-white/40">
                {form413?.ok
                  ? missing413 === 0
                    ? "All fields complete"
                    : `${missing413} field${missing413 === 1 ? "" : "s"} missing`
                  : "Unable to load"}
              </div>
            </div>
            <a
              href={`/api/deals/${dealId}/sba/forms/413/build`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white/60 hover:bg-white/10"
            >
              Details
            </a>
          </div>
          {form413?.missing?.map((s) =>
            s.missing.length > 0 ? (
              <div key={s.ownership_entity_id} className="mt-2 text-xs text-white/40">
                Owner {s.ownership_entity_id.slice(0, 8)}: {s.missing.join(", ")}
              </div>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type {
  CommitteeAnticipationReport,
  CommitteeObjection,
  CommitteePosture,
} from "@/lib/creditMemo/committee/types";

const POSTURE_LABEL: Record<CommitteePosture, string> = {
  committee_ready: "Committee-ready",
  workable_with_mitigants: "Workable with mitigants",
  hard_sell: "Hard sell",
  not_ready: "Not ready",
};

const POSTURE_TONE: Record<CommitteePosture, string> = {
  committee_ready: "border-emerald-300 bg-emerald-50",
  workable_with_mitigants: "border-amber-300 bg-amber-50",
  hard_sell: "border-rose-300 bg-rose-50",
  not_ready: "border-gray-300 bg-gray-50",
};

const SEVERITY_DOT: Record<CommitteeObjection["severity"], string> = {
  hard: "bg-rose-600",
  soft: "bg-amber-500",
  info: "bg-gray-400",
};

export default function CommitteeAnticipationPanel({ dealId }: { dealId: string }) {
  const [report, setReport] = useState<CommitteeAnticipationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/committee-anticipation`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setError(json.error ?? "load_failed");
        } else {
          setReport(json.report as CommitteeAnticipationReport);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  if (loading) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">
          Buddy&apos;s Committee Read
        </h2>
        <p className="mt-1 text-sm text-gray-600">Analyzing committee posture…</p>
      </section>
    );
  }

  if (error || !report) {
    return (
      <section className="rounded-lg border border-rose-200 bg-rose-50 p-5">
        <h2 className="text-base font-semibold text-gray-900">
          Buddy&apos;s Committee Read
        </h2>
        <p className="mt-1 text-sm text-rose-700">
          Unable to load the committee anticipation report{error ? `: ${error}` : ""}.
        </p>
      </section>
    );
  }

  const tone = POSTURE_TONE[report.posture];
  return (
    <section className={`rounded-lg border p-5 ${tone}`}>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-900">
            Buddy&apos;s Committee Read
          </h2>
          <p className="text-sm font-medium text-gray-900">{report.headline}</p>
          {report.positioning.frame ? (
            <p className="mt-0.5 text-xs italic text-gray-700">
              {report.positioning.frame}
            </p>
          ) : null}
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-semibold text-gray-900">
            {Math.round(report.confidence_score)}%
          </div>
          <div className="text-xs uppercase tracking-wide text-gray-700">
            {POSTURE_LABEL[report.posture]}
          </div>
        </div>
      </header>

      {/* Lead with */}
      {report.positioning.lead_with.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
            Lead with
          </h3>
          <ul className="mt-1 space-y-1 text-sm text-gray-900">
            {report.positioning.lead_with.map((line, i) => (
              <li key={i} className="leading-snug">{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Likely objections */}
      {report.objections.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
            Likely committee objections
          </h3>
          <ul className="mt-1 space-y-1.5">
            {report.objections.map((o) => (
              <li key={o.code} className="flex items-start gap-2 text-sm">
                <span
                  className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[o.severity]}`}
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-900">{o.label}</div>
                  <div className="text-xs text-gray-700">{o.rationale}</div>
                  {o.mitigant ? (
                    <div className="mt-0.5 text-xs text-emerald-800">
                      <span className="font-semibold">Mitigant:</span> {o.mitigant}
                    </div>
                  ) : null}
                </div>
                {o.fixPath ? (
                  <Link
                    href={o.fixPath}
                    className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-semibold text-gray-800 hover:bg-gray-50"
                  >
                    Address
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Documentation gaps */}
      {report.doc_weaknesses.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
            Documentation gaps
          </h3>
          <ul className="mt-1 space-y-1 text-sm text-gray-900">
            {report.doc_weaknesses.map((d) => (
              <li key={d.code} className="flex items-start justify-between gap-2">
                <span>
                  <span className="font-semibold">{d.label}</span>{" "}
                  <span className="text-xs text-gray-700">{d.rationale}</span>
                </span>
                {d.fixPath ? (
                  <Link
                    href={d.fixPath}
                    className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-semibold text-gray-800 hover:bg-gray-50"
                  >
                    Fix
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Prep for */}
      {report.positioning.prepare_for.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
            Prepare for
          </h3>
          <ul className="mt-1 space-y-1 text-sm text-gray-900">
            {report.positioning.prepare_for.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Follow-up questions */}
      {report.follow_ups.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
            Probable follow-up questions
          </h3>
          <ul className="mt-1 space-y-1 text-sm text-gray-900">
            {report.follow_ups.map((q, i) => (
              <li key={i}>· {q}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

"use client";

import Link from "next/link";
import type { MemoInputReadiness } from "@/lib/creditMemo/inputs/types";

type Props = {
  readiness: MemoInputReadiness;
};

export default function MemoInputReadinessPanel({ readiness }: Props) {
  const score = Math.round(readiness.readiness_score);
  const tone = readiness.ready
    ? "border-emerald-300 bg-emerald-50"
    : score >= 70
    ? "border-amber-300 bg-amber-50"
    : "border-rose-300 bg-rose-50";

  return (
    <section className={`rounded-lg border p-5 ${tone}`}>
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Memo Readiness</h2>
          <p className="text-xs text-gray-700">
            Authoritative server-side gate for banker submission.
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold text-gray-900">{score}%</div>
          <div className="text-xs text-gray-700">
            {readiness.ready ? "Ready to submit" : "Blocked"}
          </div>
        </div>
      </header>

      {/* Top required action — Perfect Banker Flow v1: tell the banker the
          single next thing rather than a generic 62% score with no path. */}
      {!readiness.ready && readiness.blockers.length > 0 ? (
        <div className="mt-3 rounded-md border border-rose-300 bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">
            Next required action
          </div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-gray-900">
              {readiness.blockers[0].label}
            </div>
            <Link
              href={readiness.blockers[0].fixPath}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700"
            >
              Fix now
            </Link>
          </div>
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
        <Check label="Borrower story" ok={readiness.borrower_story_complete} />
        <Check label="Management" ok={readiness.management_complete} />
        <Check label="Collateral" ok={readiness.collateral_complete} />
        <Check label="Financials" ok={readiness.financials_complete} />
        <Check label="Research" ok={readiness.research_complete} />
        <Check label="Conflicts resolved" ok={readiness.conflicts_resolved} />
      </div>

      {readiness.blockers.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
            Blockers
          </h3>
          <ul className="mt-1 space-y-1.5">
            {readiness.blockers.map((b) => (
              <li key={b.code} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 inline-block h-2 w-2 rounded-full bg-rose-600" />
                <span className="flex-1">
                  {b.label}{" "}
                  <span className="text-xs text-gray-600">[owner: {b.owner}]</span>
                </span>
                <Link
                  href={b.fixPath}
                  className="rounded border border-gray-300 px-2 py-0.5 text-xs font-semibold text-gray-800 hover:bg-white"
                >
                  Fix
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {readiness.warnings.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
            Warnings
          </h3>
          <ul className="mt-1 space-y-1 text-sm text-gray-700">
            {readiness.warnings.map((w) => (
              <li key={w.code}>⚠ {w.label}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Check({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full ${
          ok ? "bg-emerald-600" : "bg-gray-300"
        }`}
        aria-hidden="true"
      />
      <span className={ok ? "text-gray-900" : "text-gray-700"}>{label}</span>
    </div>
  );
}

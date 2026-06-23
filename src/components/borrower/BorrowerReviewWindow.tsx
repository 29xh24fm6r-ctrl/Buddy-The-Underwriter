"use client";

export function BorrowerReviewWindow({
  title,
  summary,
  windowLabel,
}: {
  title: string;
  summary: string;
  windowLabel: string;
}) {
  return (
    <section className="rounded-[1.5rem] border border-stone-200 bg-[linear-gradient(135deg,_#fffdf8_0%,_#fff7ed_100%)] p-5 shadow-sm sm:p-6">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
        Review window
      </div>
      <h2 className="mt-2 text-xl font-semibold text-stone-950">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-stone-700">{summary}</p>
      <div className="mt-4 rounded-[1rem] border border-white/80 bg-white/90 px-4 py-3 text-sm font-semibold text-stone-900">
        {windowLabel}
      </div>
    </section>
  );
}

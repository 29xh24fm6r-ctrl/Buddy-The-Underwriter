"use client";

export function BorrowerExpectationCard({
  title,
  points,
}: {
  title: string;
  points: string[];
}) {
  return (
    <section className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
        What to expect
      </div>
      <h2 className="mt-2 text-xl font-semibold text-stone-950">{title}</h2>
      <ul className="mt-4 space-y-3">
        {points.map((point) => (
          <li key={point} className="rounded-[1rem] border border-stone-200 bg-stone-50/70 px-4 py-3 text-sm leading-6 text-stone-700">
            {point}
          </li>
        ))}
      </ul>
    </section>
  );
}

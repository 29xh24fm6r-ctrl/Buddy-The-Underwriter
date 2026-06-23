"use client";

type ConfidenceTone = "progress" | "review" | "complete";

export function BorrowerProgressConfidence({
  title,
  bullets,
  tone,
}: {
  title: string;
  bullets: string[];
  tone: ConfidenceTone;
}) {
  const toneClass =
    tone === "complete"
      ? "border-emerald-200 bg-emerald-50/70"
      : tone === "review"
        ? "border-sky-200 bg-sky-50/70"
        : "border-amber-200 bg-amber-50/70";

  return (
    <section className={`rounded-[1.5rem] border p-5 shadow-sm sm:p-6 ${toneClass}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
        Confidence check
      </div>
      <h2 className="mt-2 text-xl font-semibold text-stone-950">{title}</h2>
      <ul className="mt-4 space-y-2 text-sm leading-6 text-stone-700">
        {bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
    </section>
  );
}

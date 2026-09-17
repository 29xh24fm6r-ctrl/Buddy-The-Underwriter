import { explainProgramOptions } from "@/lib/sba/programGuidance";
import type { GuidedSnapshot } from "@/lib/borrower/guidedPackage/questions";
import { choiceLabel } from "@/lib/borrower/journey/discovery";
export function ProgramOptions({
  snapshot,
  goal,
}: {
  snapshot?: GuidedSnapshot;
  goal?: string;
}) {
  const get = (id: string) =>
    snapshot?.questions.find((q) => q.id === id)?.value;
  const amount = get("loan.amount_requested");
  const guidance = explainProgramOptions({
    goal: String(get("A11") ?? goal ?? ""),
    specialty: String(get("A15") ?? ""),
    occupancy: String(get("A14") ?? ""),
    stage: String(get("A12") ?? ""),
    amount: typeof amount === "number" ? amount : null,
  });
  return (
    <section aria-label="Financing paths to explore" className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-sky-700">
          Understand your options
        </p>
        <h3 className="mt-2 text-2xl font-semibold text-slate-900">
          A starting point, shaped around you.
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          These are paths to explore, not a qualification result. You don’t have
          to choose a program today.
        </p>
      </div>
      {get("A13") && (
        <p className="rounded-xl bg-sky-50 p-4 text-sm">
          Your priority: <strong>{choiceLabel("A13", get("A13"))}</strong>. Ask
          the lender to compare cash required, total cost, payment structure and
          flexibility against this priority.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {guidance.topics.map((p) => (
          <article
            key={p.id}
            className="rounded-2xl border border-slate-200 bg-white p-5"
          >
            <p className="text-xs font-medium text-sky-700">
              {p.fulfillment === "application"
                ? "Application preparation available"
                : "Specialist / separate application"}
            </p>
            <h4 className="mt-2 text-lg font-semibold">{p.name}</h4>
            <p className="mt-2 text-sm leading-6 text-slate-700">{p.why}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">{p.check}</p>
            <a
              href={p.source}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-sky-800 underline"
            >
              Read SBA’s program information
              <span className="sr-only"> for {p.name}</span>
            </a>
          </article>
        ))}
      </div>
      <p className="text-sm text-slate-600">{guidance.missing}</p>
      {guidance.requiresPolicyRefresh && (
        <p className="rounded-xl bg-amber-50 p-4 text-sm">
          SBA published a policy version effective October 1, 2026. Have your
          lender confirm the applicable current rules before choosing a
          structure.
        </p>
      )}
      <details className="text-sm text-slate-600">
        <summary className="cursor-pointer py-3">
          How this guidance works
        </summary>
        <p className="leading-6">
          Based on your saved goal and stated needs, using public SBA program
          descriptions reviewed {guidance.version}. It does not calculate
          approval odds, payments or rates, and does not change your selected
          program. Your lender evaluates current policy and actual terms.
          Changing an answer updates these explanations.
        </p>
        <a
          className="inline-flex min-h-11 items-center text-sky-800 underline"
          href="https://legacy.sba.gov/local-assistance/find"
          target="_blank"
          rel="noreferrer"
        >
          Find an SBA resource partner
        </a>
      </details>
    </section>
  );
}

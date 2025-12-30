import { Container, Section } from "@/components/marketing/MarketingShell";

const steps = [
  {
    n: "01",
    title: "Load a deal",
    body: "Banker loads a deal — or sends a borrower upload link. Same pipeline either way.",
  },
  {
    n: "02",
    title: "Collect documents",
    body: "Uploads become typed evidence. Checklist updates automatically as documents arrive.",
  },
  {
    n: "03",
    title: "Confirm extracted truth",
    body: "Buddy highlights source evidence and requests confirmation — field by field when needed.",
  },
  {
    n: "04",
    title: "Run underwriting + compliance",
    body: "Policies execute. Exceptions surface. Decisions are recorded with evidence and lineage.",
  },
];

export function HowItWorks() {
  return (
    <Section id="how" className="bg-black/[0.02]">
      <Container>
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="text-sm font-medium text-ink-muted">How it works</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink-strong sm:text-4xl">
              Same flow. Every loan. Every time.
            </h2>
            <p className="mt-4 text-base text-ink-body leading-relaxed">
              Buddy is designed so execution doesn&apos;t depend on who&apos;s having a &quot;busy week.&quot;
              It&apos;s a system — not a scramble.
            </p>
          </div>

          <div className="lg:col-span-7">
            <div className="grid gap-4">
              {steps.map((s) => (
                <div key={s.n} className="rounded-[28px] border border-black/10 bg-white p-6">
                  <div className="flex items-start justify-between gap-6">
                    <div>
                      <div className="text-xs font-medium text-ink-muted">Step {s.n}</div>
                      <div className="mt-2 text-lg font-semibold text-ink-strong">{s.title}</div>
                      <div className="mt-2 text-sm text-ink-body leading-relaxed">{s.body}</div>
                    </div>
                    <div className="hidden sm:grid h-12 w-12 place-items-center rounded-2xl border border-black/10 bg-black/[0.02] text-sm font-semibold">
                      {s.n}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-[28px] border border-black/10 bg-white p-6">
              <div className="text-sm font-semibold text-ink-strong">The rule</div>
              <div className="mt-2 text-sm text-ink-body leading-relaxed">
                If a fact matters, Buddy ties it to evidence. If a decision happens, Buddy logs it.
                If someone needs an update, Buddy sends it with context.
              </div>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}

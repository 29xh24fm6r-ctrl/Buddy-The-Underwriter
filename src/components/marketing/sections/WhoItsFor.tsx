import { Container, Section } from "@/components/marketing/MarketingShell";

const personas = [
  {
    title: "Bankers",
    bullets: ["Faster closes", "Less babysitting", "One source of truth", "Cleaner handoffs"],
  },
  {
    title: "Underwriters",
    bullets: ["Verified data", "No rework", "Policies that run", "Evidence on every number"],
  },
  {
    title: "Borrowers",
    bullets: ["Clear requests", "Guided uploads", "Confidence not confusion", "Always know what's next"],
  },
  {
    title: "Ops / Compliance",
    bullets: ["Audit-ready by default", "Decision lineage", "Controlled access", "Fort Knox posture"],
  },
];

export function WhoItsFor() {
  return (
    <Section id="who">
      <Container>
        <div className="max-w-2xl">
          <div className="text-sm font-medium text-black/60">Who it&apos;s for</div>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Built for every actor in the loan.
          </h2>
          <p className="mt-4 text-base text-black/70 leading-relaxed">
            Buddy isn&apos;t a portal. It&apos;s the shared operating layer across banker, borrower,
            underwriting, and compliance — with the same truth underneath.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {personas.map((p) => (
            <div key={p.title} className="rounded-[28px] border border-black/10 bg-white p-6">
              <div className="text-lg font-semibold">{p.title}</div>
              <div className="mt-4 grid gap-2 text-sm text-black/70">
                {p.bullets.map((b) => (
                  <div key={b} className="rounded-2xl border border-black/10 p-3">
                    {b}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Container>
    </Section>
  );
}

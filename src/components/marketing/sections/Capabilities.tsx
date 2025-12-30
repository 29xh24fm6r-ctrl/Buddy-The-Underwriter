import { Container, Section } from "@/components/marketing/MarketingShell";

const cards = [
  {
    title: "Intake becomes structured truth",
    quote: "Documents aren't files. They are evidence.",
    body:
      "Upload once — banker or borrower. Everything becomes typed, canonical, and ready for downstream underwriting.",
  },
  {
    title: "Documents become verified data",
    quote: "Humans approve. Machines remember forever.",
    body:
      "Buddy extracts values, highlights source evidence, and asks for confirmation. No rekeying. No guesswork.",
  },
  {
    title: "Underwriting becomes a system",
    quote: "Not tribal knowledge. Repeatable execution.",
    body:
      "Policies, ratios, exceptions, and decisions become runnable workflows — with an audit trail by default.",
  },
  {
    title: "Communication is native",
    quote: "No more \"just checking in\" emails.",
    body:
      "Email + SMS with context, logged automatically. Borrowers always know what's next and why.",
  },
  {
    title: "Compliance is baked in",
    quote: "If it isn't auditable, it doesn't exist.",
    body:
      "Evidence lineage, decision history, and immutable logs — built for regulated, sensitive workflows.",
  },
  {
    title: "A memory across deals",
    quote: "Every loan makes the next one better.",
    body:
      "Buddy learns your policies, templates, and operating patterns — so execution compounds over time.",
  },
];

export function Capabilities() {
  return (
    <Section>
      <Container>
        <div className="max-w-2xl">
          <div className="text-sm font-medium text-ink-muted">What Buddy actually does</div>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink-strong sm:text-4xl">
            The &quot;Holy moly&quot; part is simple:
          </h2>
          <p className="mt-4 text-base text-ink-body leading-relaxed">
            Buddy turns messy lending into a clean operating flow — from intake to decision —
            without losing the nuance that real commercial underwriting requires.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <div
              key={c.title}
              className="rounded-[28px] border border-black/10 bg-white p-6 shadow-[0_12px_40px_rgba(0,0,0,0.05)]"
            >
              <div className="text-sm font-semibold">{c.title}</div>
              <div className="mt-3 rounded-2xl border border-black/10 bg-black/[0.02] p-4 text-sm">
                <div className="text-xs font-medium text-ink-muted">Buddy believes</div>
                <div className="mt-1 font-medium text-ink-strong">{c.quote}</div>
              </div>
              <div className="mt-4 text-sm text-ink-body leading-relaxed">{c.body}</div>
            </div>
          ))}
        </div>
      </Container>
    </Section>
  );
}

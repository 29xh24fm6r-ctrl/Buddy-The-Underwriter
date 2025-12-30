import { Container, Section } from "@/components/marketing/MarketingShell";

const moat = [
  { title: "Canonical data model", body: "No loose shapes. No \"it depends.\" A single truth layer across the system." },
  { title: "Evidence-first architecture", body: "Every extracted value ties back to source. Trust becomes mechanical." },
  { title: "Human-in-the-loop AI", body: "Automation where safe. Confirmation where it matters. No black boxes." },
  { title: "Policy-aware workflows", body: "Rules, ratios, and exceptions are runnable — not tribal knowledge." },
  { title: "Memory across deals", body: "Templates, policies, and operating patterns compound over time." },
  { title: "Built for regulation", body: "Audit trails, access controls, and lineage as first-class primitives." },
];

export function Moat() {
  return (
    <Section id="moat" className="bg-black/[0.02]">
      <Container>
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="text-sm font-medium text-black/60">Why this wins</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              This isn&apos;t a feature set.
              <br />
              It&apos;s an operating system.
            </h2>
            <p className="mt-4 text-base text-black/70 leading-relaxed">
              You can&apos;t bolt this on. You have to build it this way — with evidence, truth,
              and execution as the foundation.
            </p>
          </div>

          <div className="lg:col-span-7">
            <div className="grid gap-4 sm:grid-cols-2">
              {moat.map((m) => (
                <div key={m.title} className="rounded-[28px] border border-black/10 bg-white p-6">
                  <div className="text-sm font-semibold">{m.title}</div>
                  <div className="mt-2 text-sm text-black/70 leading-relaxed">{m.body}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-[28px] border border-black/10 bg-white p-6">
              <div className="text-sm font-semibold">The punchline</div>
              <div className="mt-2 text-sm text-black/70 leading-relaxed">
                Buddy turns lending from &quot;heroic effort&quot; into &quot;repeatable execution.&quot;
              </div>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}

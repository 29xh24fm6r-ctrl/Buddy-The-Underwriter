import { Container, Section } from "@/components/marketing/MarketingShell";

export function NewCategory() {
  return (
    <Section id="what" className="bg-black/[0.02]">
      <Container>
        <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-6">
            <div className="text-sm font-medium text-ink-muted">Meet the new category</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink-strong sm:text-4xl">
              Buddy replaces the stack.
            </h2>
            <p className="mt-4 text-base text-ink-body leading-relaxed">
              Buddy doesn&apos;t &quot;integrate&quot; lending. Buddy understands lending.
              Documents become evidence. Evidence becomes verified truth.
              Truth powers underwriting, compliance, and communication — automatically.
            </p>
            <p className="mt-4 text-sm text-ink-muted">
              This is not a feature set. It&apos;s an operating system for loans.
            </p>
          </div>

          <div className="lg:col-span-6">
            <div className="rounded-[28px] border border-black/10 bg-white p-6 shadow-[0_18px_60px_rgba(0,0,0,0.06)]">
              <div className="text-sm font-medium">Replaces</div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                {[
                  "Portal",
                  "DMS",
                  "OCR tool",
                  "Checklist tracker",
                  "CRM workflows",
                  "Email threads",
                  "Task chasing",
                  "Decision docs",
                ].map((x) => (
                  <div key={x} className="rounded-2xl border border-black/10 p-4">
                    {x}
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-2xl border border-black/10 bg-black/[0.02] p-4">
                <div className="text-xs font-medium text-ink-muted">The shift</div>
                <div className="mt-2 text-sm leading-relaxed">
                  From &quot;files and follow-ups&quot; → to &quot;evidence and execution.&quot;
                </div>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}

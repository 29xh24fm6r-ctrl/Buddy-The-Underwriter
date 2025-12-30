import { Container, Section, Hairline } from "@/components/marketing/MarketingShell";

const bullets = [
  "Portals that don't talk to underwriting",
  "Documents emailed, uploaded, re-uploaded",
  "OCR no one fully trusts",
  "Checklists tracked in spreadsheets",
  "Borrowers confused by vague requests",
  "Bankers babysitting status updates",
  "Underwriters retyping the same data",
];

export function OldWorld() {
  return (
    <Section>
      <Container>
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="text-sm font-medium text-ink-muted">The old world</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink-strong sm:text-4xl">
              Commercial lending is held together by duct tape.
            </h2>
            <p className="mt-4 text-base text-ink-body leading-relaxed">
              Most &quot;lending software&quot; is a thin layer over chaos. The result is
              constant rework, constant follow-ups, and constant uncertainty.
            </p>
          </div>

          <div className="lg:col-span-7">
            <div className="rounded-[28px] border border-black/10 bg-white p-6">
              <div className="grid gap-3 sm:grid-cols-2">
                {bullets.map((b) => (
                  <div key={b} className="rounded-2xl border border-black/10 p-4 text-sm text-ink-body">
                    {b}
                  </div>
                ))}
              </div>

              <Hairline />
              <div className="mt-5 text-lg font-semibold text-ink-strong">
                Every loan is rebuilt from scratch. Every time.
              </div>
              <div className="mt-1 text-sm text-ink-muted">
                Buddy exists because this is not fixable with another &quot;tool.&quot;
              </div>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}

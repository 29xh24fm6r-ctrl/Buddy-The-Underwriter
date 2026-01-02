"use client";

import { Container, Section } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function Hero() {
  return (
    <Section className="pt-14 sm:pt-20">
      <Container>
        <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-7">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Not lending software</Badge>
              <Badge>Built for sensitive documents</Badge>
              <Badge>Evidence-first underwriting</Badge>
            </div>

            <h1 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight text-ink-strong sm:text-6xl">
              Buddy is not an SBA platform.
              <br />
              Buddy is a{" "}
              <span className="underline decoration-black/15 underline-offset-8">
                Loan Operations System.
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-body sm:text-lg">
              One system that runs intake, documents, verification, underwriting,
              compliance, communication, and decisions — end to end.
            </p>

            <p className="mt-3 text-sm text-ink-muted">
              If Salesforce ran commercial lending, this is what it would look like.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" onClick={() => location.assign("#how")}>
                See how Buddy works
              </Button>
              <Button variant="secondary" size="lg" onClick={() => location.assign("/deals")}>
                Load a demo deal
              </Button>
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="rounded-[28px] border border-black/10 bg-gradient-to-b from-black/[0.03] to-transparent p-6 shadow-[0_18px_60px_rgba(0,0,0,0.07)]">
              <div className="text-sm font-medium text-ink-strong">What you feel in week 1</div>
              <div className="mt-2 text-sm text-ink-body leading-relaxed">
                • Uploads become typed evidence<br />
                • Data becomes confirmed truth<br />
                • Underwriting becomes a repeatable system<br />
                • Borrowers always know what's next<br />
                • Every decision is auditable
              </div>

              <div className="mt-6 rounded-2xl border border-black/10 bg-white p-4">
                <div className="text-xs font-medium text-ink-muted">Buddy's promise</div>
                <div className="mt-2 text-sm leading-relaxed text-ink-body">
                  Every loan follows the same operating flow — not a different
                  "process" per banker, per team, per day.
                </div>
              </div>

              <div className="mt-6 text-xs text-ink-faint">
                Built for regulated workflows. Designed for speed.
              </div>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}

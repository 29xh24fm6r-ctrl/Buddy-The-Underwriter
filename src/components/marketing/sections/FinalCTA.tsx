"use client";

import { Container, Section } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";

export function FinalCTA() {
  return (
    <Section>
      <Container>
        <div className="rounded-[32px] border border-black/10 bg-black p-10 text-white shadow-[0_22px_80px_rgba(0,0,0,0.18)] sm:p-14">
          <div className="max-w-2xl">
            <div className="text-sm font-medium text-white/70">Ready when you are</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              This is the future of commercial lending.
            </h2>
            <p className="mt-4 text-base text-white/80 leading-relaxed">
              Not another tool. Not another portal. A Loan Operations System — built to run
              intake, verification, underwriting, compliance, and communication as one flow.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                size="lg"
                variant="secondary"
                className="bg-white text-black hover:bg-white/90"
                onClick={() => location.assign("/deals")}
              >
                See a live deal
              </Button>
              <Button
                size="lg"
                className="bg-white/10 text-white hover:bg-white/15 focus-visible:ring-white"
                onClick={() => location.assign("/auth")}
              >
                Talk to Buddy
              </Button>
            </div>

            <div className="mt-6 text-xs text-white/60">
              Built for sensitive docs (tax returns, PFS, bank statements) — with an evidence trail.
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}

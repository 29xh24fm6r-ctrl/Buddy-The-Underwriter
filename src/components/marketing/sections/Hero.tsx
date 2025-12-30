"use client";

import { Container, Section } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { motion } from "framer-motion";

export function Hero() {
  return (
    <Section className="pt-14 sm:pt-20">
      <Container>
        <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-7">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="flex flex-wrap items-center gap-2"
            >
              <Badge>Not lending software</Badge>
              <Badge>Built for sensitive documents</Badge>
              <Badge>Evidence-first underwriting</Badge>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.05 }}
              className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl"
            >
              Buddy is not an SBA platform.
              <br />
              Buddy is a{" "}
              <span className="underline decoration-black/15 underline-offset-8">
                Loan Operations System.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.1 }}
              className="mt-6 max-w-xl text-base leading-relaxed text-black/70 sm:text-lg"
            >
              One system that runs intake, documents, verification, underwriting,
              compliance, communication, and decisions — end to end.
            </motion.p>

            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.15 }}
              className="mt-3 text-sm text-black/60"
            >
              If Salesforce ran commercial lending, this is what it would look like.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.2 }}
              className="mt-8 flex flex-col gap-3 sm:flex-row"
            >
              <Button size="lg" onClick={() => location.assign("#how")}>
                See how Buddy works
              </Button>
              <Button variant="secondary" size="lg" onClick={() => location.assign("/deals")}>
                Load a demo deal
              </Button>
            </motion.div>
          </div>

          <div className="lg:col-span-5">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15 }}
              className="rounded-[28px] border border-black/10 bg-gradient-to-b from-black/[0.03] to-transparent p-6 shadow-[0_18px_60px_rgba(0,0,0,0.07)]"
            >
              <div className="text-sm font-medium">What you feel in week 1</div>
              <div className="mt-2 text-sm text-black/70 leading-relaxed">
                • Uploads become typed evidence<br />
                • Data becomes confirmed truth<br />
                • Underwriting becomes a repeatable system<br />
                • Borrowers always know what&apos;s next<br />
                • Every decision is auditable
              </div>

              <div className="mt-6 rounded-2xl border border-black/10 bg-white p-4">
                <div className="text-xs font-medium text-black/60">Buddy&apos;s promise</div>
                <div className="mt-2 text-sm leading-relaxed">
                  Every loan follows the same operating flow — not a different
                  &quot;process&quot; per banker, per team, per day.
                </div>
              </div>

              <div className="mt-6 text-xs text-black/50">
                Built for regulated workflows. Designed for speed.
              </div>
            </motion.div>
          </div>
        </div>
      </Container>
    </Section>
  );
}

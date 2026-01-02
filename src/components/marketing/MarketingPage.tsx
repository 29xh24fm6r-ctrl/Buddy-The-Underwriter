"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useMemo, useRef } from "react";
import { cn } from "@/lib/ui/cn";

function Glow() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -top-40 left-1/2 h-[520px] w-[980px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
      <div className="absolute top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-white/5 blur-3xl" />
    </div>
  );
}

function TopNav() {
  return (
    <div className="sticky top-0 z-50 border-b border-white/10 bg-black/40 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link  href="/" className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-xl bg-white/10 ring-1 ring-white/15" />
          <div className="text-sm font-semibold tracking-wide text-white/90">
            Buddy <span className="text-white/50">Loan Ops OS</span>
          </div>
        </Link>

        <div className="hidden items-center gap-6 md:flex">
          <a href="#product" className="text-sm text-white/70 hover:text-white">Product</Link>
          <a href="#how" className="text-sm text-white/70 hover:text-white">How it works</Link>
          <a href="#solutions" className="text-sm text-white/70 hover:text-white">Solutions</Link>
          <a href="#security" className="text-sm text-white/70 hover:text-white">Security</Link>
          <Link  href="/sign-in" className="text-sm text-white/70 hover:text-white">Sign in</Link>
          <Link
             href="/sign-up"
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
          >
            Start free trial
          </Link>
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <Link  href="/sign-in" className="rounded-xl border border-white/15 px-3 py-2 text-sm text-white/80">
            Sign in
          </Link>
          <Link  href="/sign-up" className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-black">
            Try
          </Link>
        </div>
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-white/80">
      {children}
    </span>
  );
}

function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, 80]);
  const opacity = useTransform(scrollYProgress, [0, 1], [1, 0.55]);

  return (
    <section ref={ref} className="relative overflow-hidden">
      <Glow />
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-12 md:pb-24 md:pt-20">
        <div className="flex flex-col gap-10">
          <div className="flex flex-wrap items-center gap-2">
            <Pill>New category</Pill>
            <Pill>Loan Operations OS</Pill>
            <Pill>Examiner-safe by default</Pill>
          </div>

          <motion.div style={{ y, opacity }}>
            <h1 className="max-w-4xl text-balance text-4xl font-semibold tracking-tight text-white md:text-6xl">
              Meet Buddy.
              <span className="block text-white/80">
                The first true Operating System for commercial lending.
              </span>
            </h1>

            <p className="mt-5 max-w-2xl text-pretty text-base leading-7 text-white/65 md:text-lg">
              Not "software for SBA." Not another portal. Buddy orchestrates documents, borrowers, compliance,
              underwriting, decisions, and servicing—so loan teams move faster <span className="text-white/80">without losing control</span>.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                 href="/sign-up"
                className="inline-flex items-center justify-center rounded-2xl bg-white px-6 py-3 text-sm font-semibold text-black hover:opacity-90"
              >
                Start free trial
              </Link>
              <a
                href="#how"
                className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-white/90 hover:bg-white/10"
              >
                See how it works
              </Link>
              <div className="text-xs text-white/50 sm:ml-2">
                Built for SBA + CRE + C&I. Forged in audit reality.
              </div>
            </div>
          </motion.div>

          <div className="grid gap-4 md:grid-cols-3">
            <ValueCard
              title="Control Layer"
              desc="Canonical event ledger, immutable traces, policy-driven governance. Explainable decisions—always."
              tag="Examiner-first"
            />
            <ValueCard
              title="Workflow Layer"
              desc="Borrower + banker flows, checklists, requests, packaging, committee, servicing handoff—end-to-end."
              tag="No dead ends"
            />
            <ValueCard
              title="Intelligence Layer"
              desc="Understands documents, extracts fields, flags inconsistencies, escalates human review when needed."
              tag="Human-in-the-loop"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function ValueCard({ title, desc, tag }: { title: string; desc: string; tag: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-white/90">{title}</div>
        <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs font-semibold text-white/60">
          {tag}
        </span>
      </div>
      <div className="mt-3 text-sm leading-6 text-white/65">{desc}</div>
    </div>
  );
}

function Problem() {
  const pain = useMemo(
    () => [
      "Documents scattered across inboxes, portals, and shared drives",
      "Borrowers upload the wrong thing—again—and it resets timelines",
      "Checklists live in spreadsheets no one actually trusts",
      "Compliance discovered after decisions are made",
      "Underwriting knowledge trapped in senior people's heads",
    ],
    [],
  );

  return (
    <section className="mx-auto max-w-6xl px-5 py-16 md:py-24">
      <div className="grid gap-10 md:grid-cols-2 md:items-start">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-white/50">Reality</div>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-white md:text-4xl">
            Loan teams aren't short on tools.
            <span className="block text-white/75">They're short on a system.</span>
          </h2>
          <p className="mt-4 max-w-xl text-pretty text-sm leading-7 text-white/65 md:text-base">
            Every lender ends up building a fragile, homegrown operating system out of emails, folders, and heroics—
            then spends years babysitting it. Buddy replaces that with a single, coherent OS.
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
          <div className="text-sm font-semibold text-white/85">What breaks most platforms</div>
          <ul className="mt-4 space-y-3">
            {pain.map((x) => (
              <li key={x} className="flex gap-3 text-sm leading-6 text-white/65">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/35" />
                <span>{x}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4 text-xs leading-6 text-white/60">
            <span className="text-white/80 font-semibold">Buddy's thesis:</span> the bottleneck isn't underwriting.
            It's operations. So we built the OS.
          </div>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      k: "01",
      t: "Orchestrate intake",
      d: "Borrower + banker flows unify into one deal context. No orphan docs. No ghost threads.",
    },
    {
      k: "02",
      t: "Normalize evidence",
      d: "Every upload becomes structured evidence: metadata, extracted fields, confidence, and audit traces.",
    },
    {
      k: "03",
      t: "Run governed automation",
      d: "Policies trigger actions, escalations, committee workflows, and human review where required.",
    },
    {
      k: "04",
      t: "Ship decisions safely",
      d: "Decisions are explainable, reproducible, and examiner-ready—without slowing the team down.",
    },
  ];

  return (
    <section id="how" className="border-y border-white/10 bg-white/[0.02]">
      <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-white/50">How it works</div>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-white md:text-4xl">
              A lending OS has to do more than store files.
              <span className="block text-white/75">It has to run the process.</span>
            </h2>
          </div>
          <div className="max-w-md text-sm leading-7 text-white/60">
            The magic isn't one feature. It's the integration of workflow, intelligence, and control into a single system.
          </div>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {steps.map((s) => (
            <motion.div
              key={s.k}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.35 }}
              className="rounded-3xl border border-white/10 bg-white/[0.04] p-6"
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-white/50">{s.k}</div>
                <div className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs font-semibold text-white/60">
                  Canonical
                </div>
              </div>
              <div className="mt-3 text-lg font-semibold text-white/90">{s.t}</div>
              <div className="mt-2 text-sm leading-7 text-white/65">{s.d}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Solutions() {
  const cards = [
    {
      title: "SBA lending",
      desc: "Forged in the hardest environment: documentation, auditability, and zero tolerance for gaps.",
      proof: "If it runs SBA end-to-end, it runs anything.",
    },
    {
      title: "CRE + owner-occupied",
      desc: "Package-ready borrower artifacts, recurring document refresh, and traceable decision logic.",
      proof: "No more \"where did that number come from?\"",
    },
    {
      title: "C&I and program lending",
      desc: "Policy-driven workflows for covenants, financial spreads, renewals, and exceptions.",
      proof: "Operations scale without headcount scaling.",
    },
  ];

  return (
    <section id="solutions" className="mx-auto max-w-6xl px-5 py-16 md:py-24">
      <div className="grid gap-10 md:grid-cols-2 md:items-start">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-white/50">Solutions</div>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-white md:text-4xl">
            Built for the hardest lending reality.
            <span className="block text-white/75">Then generalized into a platform.</span>
          </h2>
          <p className="mt-4 max-w-xl text-pretty text-sm leading-7 text-white/65 md:text-base">
            SBA is not the product boundary—it's the proof. Buddy is the system that turns complex lending into an
            operational machine.
          </p>
        </div>

        <div className="grid gap-4">
          {cards.map((c) => (
            <div key={c.title} className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
              <div className="text-base font-semibold text-white/90">{c.title}</div>
              <div className="mt-2 text-sm leading-7 text-white/65">{c.desc}</div>
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4 text-xs leading-6 text-white/60">
                {c.proof}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Security() {
  return (
    <section id="security" className="border-y border-white/10 bg-white/[0.02]">
      <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="grid gap-10 md:grid-cols-2 md:items-start">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-white/50">Security</div>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-white md:text-4xl">
              Enterprise-grade control.
              <span className="block text-white/75">Not bolted on.</span>
            </h2>
            <p className="mt-4 max-w-xl text-pretty text-sm leading-7 text-white/65 md:text-base">
              Commercial lending demands trust: audit trails, access control, least privilege, and explainability.
              Buddy was built with those constraints from day one.
            </p>
          </div>

          <div className="grid gap-4">
            <SecurityRow
              title="Canonical event ledger"
              desc="One immutable source of truth for actions, evidence, and decisions."
            />
            <SecurityRow
              title="Examiner-ready artifacts"
              desc="Traceable inputs → decisions with confidence and rationale."
            />
            <SecurityRow
              title="Least-privilege access"
              desc="Role-based access patterns designed for multi-tenant lending orgs."
            />
            <SecurityRow
              title="Secure uploads + decoupled storage"
              desc="Direct-to-storage signed upload architecture designed to keep your app safe and fast."
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function SecurityRow({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
      <div className="text-sm font-semibold text-white/90">{title}</div>
      <div className="mt-2 text-sm leading-7 text-white/65">{desc}</div>
    </div>
  );
}

function FinalCTA() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 md:py-24">
      <div className="relative overflow-hidden rounded-[2.25rem] border border-white/10 bg-white/[0.04] p-10 shadow-[0_30px_100px_rgba(0,0,0,0.45)]">
        <div className="absolute -top-36 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
        <div className="relative">
          <div className="text-xs font-semibold uppercase tracking-widest text-white/50">Stop managing loans</div>
          <h3 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-white md:text-4xl">
            Start operating them.
          </h3>
          <p className="mt-4 max-w-2xl text-pretty text-sm leading-7 text-white/65 md:text-base">
            If your process can't fit in a spreadsheet, Buddy is for you. Replace patchwork workflows with a real
            operating system—built for audit reality.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
               href="/sign-up"
              className={cn(
                "inline-flex items-center justify-center rounded-2xl bg-white px-6 py-3 text-sm font-semibold text-black hover:opacity-90",
              )}
            >
              Start free trial
            </Link>
            <Link
               href="/contact"
              className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-white/90 hover:bg-white/10"
            >
              Talk to us
            </Link>
          </div>
          <div className="mt-6 text-xs text-white/45">
            Category: <span className="text-white/65 font-semibold">Loan Operations OS</span> — not a portal, not a CRM, not a doc vault.
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/10 bg-black">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-white/60">
          © {new Date().getFullYear()} Buddy — Loan Operations OS
        </div>
        <div className="flex items-center gap-4 text-sm text-white/60">
          <Link className="hover:text-white"  href="/privacy">Privacy</Link>
          <Link className="hover:text-white"  href="/terms">Terms</Link>
          <Link className="hover:text-white"  href="/security">Security</Link>
        </div>
      </div>
    </footer>
  );
}

export default function MarketingPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <TopNav />
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <Solutions />
        <Security />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}

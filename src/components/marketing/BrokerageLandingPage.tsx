"use client";

import { useState } from "react";
import Link from "next/link";
import { Poppins, Plus_Jakarta_Sans } from "next/font/google";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-poppins",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
  display: "swap",
});

const STEPS = [
  {
    n: 1,
    title: "Tell Buddy About Your Business",
    desc: "Answer a few questions about your business, financials, and loan goals. Buddy guides the conversation — no paperwork yet.",
  },
  {
    n: 2,
    title: "Upload Documents",
    desc: "Tax returns, bank statements, and formation documents. Buddy extracts, organizes, and verifies everything automatically.",
  },
  {
    n: 3,
    title: "Buddy Reviews Everything",
    desc: "Your deal is analyzed against SBA guidelines, scored for readiness, and flagged for anything that needs attention — before a lender ever sees it.",
  },
  {
    n: 4,
    title: "We Build Your SBA Loan Package",
    desc: "Business plan, financial projections, feasibility study, SBA forms — your complete package, prepared and reviewed for completeness.",
  },
  {
    n: 5,
    title: "Get Matched With Qualified SBA Lenders",
    desc: "Your anonymized profile reaches qualified SBA lenders through a competitive marketplace. Your identity stays private until you decide.",
  },
  {
    n: 6,
    title: "Funding Support",
    desc: "Conditions tracking, document collection, and closing coordination — Buddy stays with you from application to funded.",
  },
];

const PACKAGE_ITEMS = [
  { title: "Executive Summary", desc: "Your deal at a glance — business overview, loan request, and key strengths." },
  { title: "Business Plan", desc: "Narrative, operations, management, and market positioning." },
  { title: "Financial Projections", desc: "5-year forecasts with assumptions, built from your actual financials." },
  { title: "Feasibility Study", desc: "Revenue analysis, break-even, and viability assessment." },
  { title: "Debt Service Coverage", desc: "DSCR calculations showing your ability to service the loan." },
  { title: "SBA Forms", desc: "1919, 1920, 912, 413 — completed accurately and cross-referenced." },
  { title: "Collateral Analysis", desc: "Asset inventory and coverage ratios organized for review." },
  { title: "Industry & Market Analysis", desc: "Market size, competitive landscape, and growth indicators." },
];

const FAQ_ITEMS = [
  {
    q: "What does it cost?",
    a: "A packaging fee of $1,000 applies at closing — it can be financed into the loan, so you're never out of pocket upfront. All fees are fully disclosed on SBA Form 159.",
  },
  {
    q: "How long does the process take?",
    a: "Most borrowers go from application to lender match in 30–60 days. The lender marketplace step itself takes about 2 business days.",
  },
  {
    q: "What documents do I need?",
    a: "Your last 3 years of business tax returns, 3 months of bank statements, a government-issued ID, and business formation documents. Buddy tells you exactly what's needed as you go.",
  },
  {
    q: "Is my information safe?",
    a: "Your identity is never shared with lenders during the matching process. Only the lender you choose ever sees your name or business details.",
  },
  {
    q: "What if I don't like any lender offers?",
    a: "You're never obligated to accept. You can re-list once within 60 days at no additional cost.",
  },
  {
    q: "What types of SBA loans does Buddy support?",
    a: "SBA 7(a) and 504 loans — acquisitions, expansions, equipment, real estate, working capital, and franchise financing.",
  },
];

export function BrokerageLandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <main
      className={`${poppins.variable} ${jakarta.variable} min-h-screen bg-[#f6f8fb] text-[#12263f] antialiased`}
      style={{ fontFamily: "var(--font-jakarta), sans-serif" }}
    >
      {/* ── 1. NAV ── */}
      <nav className="sticky top-0 z-50 border-b border-[#12263f]/[0.07] bg-[#f6f8fb]/85 px-6 py-4 backdrop-blur-xl sm:px-10">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div
              className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] text-[19px] font-extrabold italic text-white"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              B
            </div>
            <div className="leading-none">
              <div
                className="text-[20px] font-bold text-[#12263f]"
                style={{ fontFamily: "var(--font-poppins), sans-serif" }}
              >
                Buddy
              </div>
              <div className="mt-0.5 text-[8px] font-semibold tracking-[2px] text-[#6b8299]">
                THE SBA UNDERWRITER
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-4 sm:gap-8">
            <a
              href="#how"
              className="hidden text-[15px] font-semibold text-[#3d5674] transition hover:text-[#1c8de0] sm:inline"
            >
              How it works
            </a>
            <a
              href="#lenders"
              className="hidden text-[15px] font-semibold text-[#3d5674] transition hover:text-[#1c8de0] sm:inline"
            >
              For lenders
            </a>
            <Link
              href="/apply"
              className="rounded-xl bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] px-5 py-[11px] text-[15px] font-bold text-white shadow-[0_6px_18px_rgba(28,141,224,0.28)] transition hover:brightness-[1.06]"
            >
              Start your package
            </Link>
          </div>
        </div>
      </nav>

      {/* ── 2. HERO ── */}
      <section className="relative overflow-hidden bg-[linear-gradient(160deg,#0e2340_0%,#12263f_55%,#173250_100%)] px-6 py-16 text-white sm:px-10 sm:py-20 lg:py-24">
        <div
          className="pointer-events-none absolute -right-20 -top-[120px] h-[460px] w-[460px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(28,141,224,0.28), transparent 70%)",
          }}
        />
        <div className="relative mx-auto grid max-w-[1240px] items-center gap-10 lg:grid-cols-[1fr_0.9fr] lg:gap-16">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#4db8f0]/35 bg-[#1c8de0]/[0.16] px-[15px] py-[7px] text-[13px] font-semibold tracking-[0.3px] text-[#8fd0f7]">
              <span className="h-[7px] w-[7px] rounded-full bg-[#4db8f0]" />
              The world&apos;s first Loan Operations System
            </div>
            <h1
              className="mt-6 text-[32px] font-extrabold leading-[1.08] tracking-tight sm:text-[48px] lg:text-[52px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Your SBA loan package, built and matched to the right lender.
            </h1>
            <p className="mb-8 mt-5 max-w-[540px] text-[17px] leading-relaxed text-[#b9cbdd] sm:text-[19px]">
              Buddy prepares your complete SBA application, scores your
              readiness, and connects you with qualified lenders through a
              competitive marketplace.
            </p>
            <div className="flex flex-wrap gap-3.5">
              <Link
                href="/apply"
                className="rounded-xl bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] px-7 py-[15px] text-[16px] font-bold text-white shadow-[0_10px_28px_rgba(28,141,224,0.4)] transition hover:brightness-[1.06]"
              >
                Start your SBA package
              </Link>
              <a
                href="#how"
                className="rounded-xl border border-white/[0.18] bg-white/[0.08] px-7 py-[15px] text-[16px] font-bold text-white transition hover:bg-white/[0.14]"
              >
                See How Buddy Works
              </a>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[14px] text-[#b9cbdd]">
              <span>Not sure which applies?</span>
              <Link
                href="/start?path=standard"
                className="font-semibold text-white underline decoration-[#4db8f0]/50 underline-offset-4 hover:decoration-[#4db8f0]"
              >
                Independent business
              </Link>
              <span className="text-[#5b7189]">·</span>
              <Link
                href="/start?path=franchise"
                className="font-semibold text-white underline decoration-[#4db8f0]/50 underline-offset-4 hover:decoration-[#4db8f0]"
              >
                Buying a franchise
              </Link>
            </div>
            <div className="mt-10 flex flex-wrap gap-x-8 gap-y-4">
              {[
                { value: "92%", label: "Avg. confidence score" },
                { value: "End-to-end", label: "Intake to funded" },
                { value: "SBA 7(a)", label: "& 504 ready" },
              ].map((stat) => (
                <div key={stat.label} className="flex items-center gap-8">
                  <div>
                    <div
                      className="text-[24px] font-bold text-[#4db8f0] sm:text-[26px]"
                      style={{ fontFamily: "var(--font-poppins), sans-serif" }}
                    >
                      {stat.value}
                    </div>
                    <div className="mt-0.5 text-[13px] text-[#8ba1b8]">
                      {stat.label}
                    </div>
                  </div>
                  <div className="hidden h-10 w-px bg-white/[0.12] last:hidden sm:block" />
                </div>
              ))}
            </div>
          </div>
          <div className="relative hidden lg:block">
            <div
              className="absolute -inset-4 rounded-3xl"
              style={{
                background:
                  "linear-gradient(135deg, rgba(28,141,224,0.25), transparent)",
              }}
            />
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1c8de0]/[0.12] to-[#4db8f0]/[0.06]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/buddy-robot-hero.png"
                alt="Buddy the SBA Underwriter"
                className="block w-full rounded-2xl"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. DESIGNED FOR SBA FINANCING ── */}
      <section className="px-6 py-16 sm:px-10 sm:py-24">
        <div className="mx-auto max-w-[1240px]">
          <div className="mx-auto mb-12 max-w-[660px] text-center">
            <div className="text-[13px] font-bold uppercase tracking-[1.5px] text-[#1c8de0]">
              Built for your business
            </div>
            <h2
              className="mb-3 mt-3 text-[26px] font-bold tracking-tight sm:text-[36px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Designed for SBA Financing
            </h2>
            <p className="text-[16px] leading-relaxed text-[#5b7189] sm:text-[17px]">
              Whether you&apos;re acquiring a business, expanding operations, or
              buying into a franchise — Buddy builds the same complete,
              lender-ready SBA loan package.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <Link
              href="/start?path=standard"
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-[#12263f]/[0.08] bg-white p-7 shadow-[0_2px_14px_rgba(18,38,63,0.05)] transition hover:-translate-y-1 hover:shadow-[0_16px_36px_rgba(18,38,63,0.1)] sm:p-8"
            >
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#0e2340] to-[#1c8de0] text-white">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 21h18M5 21V7l8-4v18M13 21V11l6 3v7" />
                </svg>
              </div>
              <div className="inline-flex w-fit rounded-full bg-[#12263f]/[0.06] px-3 py-1.5 text-[12px] font-bold uppercase tracking-[0.5px] text-[#12263f]">
                Independent business
              </div>
              <h3
                className="mb-2 mt-3 text-[20px] font-bold tracking-tight sm:text-[21px]"
                style={{ fontFamily: "var(--font-poppins), sans-serif" }}
              >
                Buying, refinancing, or growing a business you run
              </h3>
              <p className="mb-6 flex-1 text-[15px] leading-relaxed text-[#5b7189]">
                SBA 7(a) or 504 financing for acquisition, equipment, real
                estate, working capital, or expansion.
              </p>
              <span className="inline-flex items-center gap-2 text-[15px] font-bold text-[#1c8de0] transition group-hover:gap-3">
                Start your SBA package
                <span aria-hidden="true">&rarr;</span>
              </span>
            </Link>
            <Link
              href="/start?path=franchise"
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-[#1c8de0]/[0.15] bg-gradient-to-br from-white to-[#eef6fd] p-7 shadow-[0_2px_14px_rgba(18,38,63,0.05)] transition hover:-translate-y-1 hover:shadow-[0_16px_36px_rgba(28,141,224,0.14)] sm:p-8"
            >
              <div
                className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-70"
                style={{
                  background:
                    "radial-gradient(circle, rgba(28,141,224,0.14), transparent 70%)",
                }}
              />
              <div className="relative mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] text-white">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-6 9 6M4 9v11h16V9M9 20v-6h6v6" />
                </svg>
              </div>
              <div className="relative inline-flex w-fit rounded-full bg-[#1c8de0]/[0.1] px-3 py-1.5 text-[12px] font-bold uppercase tracking-[0.5px] text-[#1c8de0]">
                Franchise
              </div>
              <h3
                className="relative mb-2 mt-3 text-[20px] font-bold tracking-tight sm:text-[21px]"
                style={{ fontFamily: "var(--font-poppins), sans-serif" }}
              >
                Buying into a franchise brand
              </h3>
              <p className="relative mb-6 flex-1 text-[15px] leading-relaxed text-[#5b7189]">
                Buddy tracks SBA data on 8,400+ brands — certification status,
                FDD Item 19 performance, and franchisor support signals built
                into your package.
              </p>
              <span className="relative inline-flex items-center gap-2 text-[15px] font-bold text-[#12263f] transition group-hover:gap-3">
                Find your brand
                <span aria-hidden="true">&rarr;</span>
              </span>
            </Link>
          </div>
          <p className="mt-6 text-center text-[14px] text-[#5b7189]">
            Not sure?{" "}
            <Link href="/start" className="font-semibold text-[#1c8de0] hover:underline">
              Just start the conversation
            </Link>{" "}
            — Buddy will figure it out.
          </p>
        </div>
      </section>

      {/* ── 4. HOW BUDDY WORKS ── */}
      <section id="how" className="bg-white px-6 py-16 sm:px-10 sm:py-24">
        <div className="mx-auto max-w-[1240px]">
          <div className="mx-auto mb-14 max-w-[660px] text-center">
            <div className="text-[13px] font-bold uppercase tracking-[1.5px] text-[#1c8de0]">
              How it works
            </div>
            <h2
              className="mb-3 mt-3 text-[28px] font-bold tracking-tight sm:text-[38px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              From Application to Approval
            </h2>
            <p className="text-[16px] leading-relaxed text-[#5b7189] sm:text-[17px]">
              Six steps. One clear path to funded.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className="rounded-2xl border border-[#12263f]/[0.07] bg-[#f6f8fb] p-7 transition hover:-translate-y-1 hover:shadow-[0_12px_30px_rgba(18,38,63,0.08)]"
              >
                <div
                  className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#0e2340] to-[#1c8de0] text-[18px] font-bold text-white"
                  style={{ fontFamily: "var(--font-poppins), sans-serif" }}
                >
                  {s.n}
                </div>
                <h3
                  className="mb-2 text-[18px] font-bold tracking-tight"
                  style={{ fontFamily: "var(--font-poppins), sans-serif" }}
                >
                  {s.title}
                </h3>
                <p className="text-[15px] leading-relaxed text-[#5b7189]">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 5. EVERYTHING YOUR SBA LENDER WANTS ── */}
      <section className="px-6 py-16 sm:px-10 sm:py-24">
        <div className="mx-auto max-w-[1240px]">
          <div className="mx-auto mb-14 max-w-[660px] text-center">
            <div className="text-[13px] font-bold uppercase tracking-[1.5px] text-[#1c8de0]">
              What you get
            </div>
            <h2
              className="mb-3 mt-3 text-[26px] font-bold tracking-tight sm:text-[36px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Everything Your SBA Lender Wants — Built Automatically
            </h2>
            <p className="text-[16px] leading-relaxed text-[#5b7189] sm:text-[17px]">
              A complete loan package, prepared to SBA standards and ready
              before underwriting begins. Nothing missing. Nothing incomplete.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PACKAGE_ITEMS.map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-[#12263f]/[0.07] bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(18,38,63,0.08)]"
              >
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[#1c8de0]/[0.1] text-[#1c8de0]">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                <h3 className="mb-1 text-[16px] font-bold">{item.title}</h3>
                <p className="text-[14px] leading-relaxed text-[#5b7189]">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 6. WHY BUSINESS OWNERS CHOOSE BUDDY ── */}
      <section className="bg-white px-6 py-16 sm:px-10 sm:py-24">
        <div className="mx-auto max-w-[1240px]">
          <div className="mx-auto mb-14 max-w-[660px] text-center">
            <div className="text-[13px] font-bold uppercase tracking-[1.5px] text-[#1c8de0]">
              For business owners
            </div>
            <h2
              className="mb-3 mt-3 text-[26px] font-bold tracking-tight sm:text-[36px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Why Business Owners Choose Buddy
            </h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              {
                title: "Your Privacy, Protected",
                desc: "Lenders see your deal — not your identity. You stay anonymous throughout the marketplace until you choose your lender.",
              },
              {
                title: "Built Right the First Time",
                desc: "No back-and-forth over missing documents. No incomplete applications. Your package arrives ready for underwriting.",
              },
              {
                title: "One Application, Multiple Lenders",
                desc: "Qualified SBA lenders compete for your deal through a transparent marketplace. You compare and choose — no pressure, no obligation.",
              },
            ].map((b) => (
              <div
                key={b.title}
                className="rounded-2xl border border-[#12263f]/[0.07] bg-[#f6f8fb] p-7 transition hover:-translate-y-1 hover:shadow-[0_12px_30px_rgba(18,38,63,0.08)] sm:p-8"
              >
                <h3
                  className="mb-3 text-[19px] font-bold tracking-tight"
                  style={{ fontFamily: "var(--font-poppins), sans-serif" }}
                >
                  {b.title}
                </h3>
                <p className="text-[15px] leading-relaxed text-[#5b7189]">
                  {b.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 7. WHY SBA LENDERS LOVE BUDDY ── */}
      <section
        id="lenders"
        data-section="bank-platform-entry"
        className="relative overflow-hidden bg-[linear-gradient(135deg,#0e2340,#173250)] px-6 py-16 text-white sm:px-10 sm:py-24"
      >
        <div
          className="pointer-events-none absolute -bottom-24 right-16 h-80 w-80 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(28,141,224,0.2), transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-[1240px]">
          <div className="mx-auto mb-14 max-w-[660px] text-center">
            <div className="text-[13px] font-bold uppercase tracking-[1.5px] text-[#8fd0f7]">
              For SBA lenders
            </div>
            <h2
              className="mb-3 mt-3 text-[26px] font-bold tracking-tight sm:text-[36px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Why SBA Lenders Love Buddy
            </h2>
            <p className="text-[16px] leading-relaxed text-[#b9cbdd] sm:text-[17px]">
              Complete packages. Consistent documentation. Deals that are ready
              for underwriting from day one.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              {
                title: "Examiner-Ready Packages",
                desc: "Every package arrives with complete documentation, audit trails, and SBA compliance checks already performed.",
              },
              {
                title: "Pre-Scored Deals",
                desc: "Confidence scores and readiness assessments help you identify strong candidates before committing underwriting resources.",
              },
              {
                title: "Standardized Documentation",
                desc: "Consistent formatting, complete cross-referencing, and uniform quality across every deal in your pipeline.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-white/[0.1] bg-white/[0.06] p-7 transition hover:bg-white/[0.1] sm:p-8"
              >
                <h3
                  className="mb-3 text-[19px] font-bold"
                  style={{ fontFamily: "var(--font-poppins), sans-serif" }}
                >
                  {item.title}
                </h3>
                <p className="text-[15px] leading-relaxed text-[#b9cbdd]">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link
              href="/underwriter"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-7 py-[15px] text-[16px] font-bold text-[#12263f] transition hover:shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
            >
              Explore the banking platform
              <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── 8. BUILT FOR TRUST ── */}
      <section className="px-6 py-16 sm:px-10 sm:py-24">
        <div className="mx-auto max-w-[1240px]">
          <div className="mx-auto mb-14 max-w-[660px] text-center">
            <div className="text-[13px] font-bold uppercase tracking-[1.5px] text-[#1c8de0]">
              Security
            </div>
            <h2
              className="mb-3 mt-3 text-[26px] font-bold tracking-tight sm:text-[36px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Built for Trust. Designed for Security.
            </h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              {
                title: "Every Action Recorded",
                desc: "An immutable audit trail tracks every decision, document, and data point from application to close.",
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                ),
              },
              {
                title: "Encrypted Document Storage",
                desc: "Your documents are encrypted at rest and in transit. Direct-to-storage uploads keep your files off intermediary servers.",
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                ),
              },
              {
                title: "Privacy by Design",
                desc: "Role-based access ensures your information is only visible to the people who need it, when they need it.",
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                ),
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-[#12263f]/[0.07] bg-white p-7 transition hover:-translate-y-1 hover:shadow-[0_12px_30px_rgba(18,38,63,0.08)] sm:p-8"
              >
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[#0e2340] text-[#4db8f0]">
                  {item.icon}
                </div>
                <h3
                  className="mb-3 text-[19px] font-bold tracking-tight"
                  style={{ fontFamily: "var(--font-poppins), sans-serif" }}
                >
                  {item.title}
                </h3>
                <p className="text-[15px] leading-relaxed text-[#5b7189]">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 9. SEE WHAT BUDDY ACTUALLY BUILDS ── */}
      <section className="bg-white px-6 py-16 sm:px-10 sm:py-24">
        <div className="mx-auto max-w-[1240px]">
          <div className="mx-auto mb-14 max-w-[660px] text-center">
            <div className="text-[13px] font-bold uppercase tracking-[1.5px] text-[#1c8de0]">
              The finished product
            </div>
            <h2
              className="mb-3 mt-3 text-[26px] font-bold tracking-tight sm:text-[36px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              See What Buddy Actually Builds
            </h2>
            <p className="text-[16px] leading-relaxed text-[#5b7189] sm:text-[17px]">
              This is what arrives in front of your lender — a complete,
              professionally prepared SBA loan package.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Executive Summary & Business Plan",
                desc: "A clear narrative covering your business, the opportunity, management experience, and loan request — written for underwriters.",
              },
              {
                title: "5-Year Financial Projections",
                desc: "Revenue forecasts, expense modeling, and cash flow analysis built from your actual financials — not generic templates.",
              },
              {
                title: "Feasibility & DSCR Analysis",
                desc: "Break-even calculations, debt service coverage ratios, and viability assessment your lender requires.",
              },
              {
                title: "SBA Forms — Complete & Accurate",
                desc: "Borrower Information (1919), Lender Application (1920), Personal Financial Statement (413) — filled, cross-referenced, and ready.",
              },
              {
                title: "Collateral & Industry Analysis",
                desc: "Asset coverage ratios, market positioning, competitive landscape, and industry risk factors organized for review.",
              },
              {
                title: "Management & Experience Summary",
                desc: "Owner qualifications, relevant experience, and management capabilities presented to SBA standards.",
              },
            ].map((doc) => (
              <div
                key={doc.title}
                className="flex gap-4 rounded-2xl border border-[#12263f]/[0.07] bg-[#f6f8fb] p-6"
              >
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1c8de0]/[0.1] text-[#1c8de0]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div>
                  <h3 className="mb-1 text-[15px] font-bold">{doc.title}</h3>
                  <p className="text-[14px] leading-relaxed text-[#5b7189]">
                    {doc.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 10. FAQ ── */}
      <section className="px-6 py-16 sm:px-10 sm:py-24">
        <div className="mx-auto max-w-[800px]">
          <div className="mb-12 text-center">
            <div className="text-[13px] font-bold uppercase tracking-[1.5px] text-[#1c8de0]">
              Common questions
            </div>
            <h2
              className="mb-3 mt-3 text-[26px] font-bold tracking-tight sm:text-[36px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Frequently Asked Questions
            </h2>
          </div>
          <div className="divide-y divide-[#12263f]/[0.08] rounded-2xl border border-[#12263f]/[0.07] bg-white">
            {FAQ_ITEMS.map((item, i) => (
              <div key={i}>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="flex w-full items-center justify-between px-6 py-5 text-left transition hover:bg-[#f6f8fb]/60 sm:px-8"
                >
                  <span className="pr-4 text-[16px] font-semibold text-[#12263f]">
                    {item.q}
                  </span>
                  <span
                    className={`shrink-0 text-[20px] text-[#6b8299] transition-transform duration-200 ${openFaq === i ? "rotate-45" : ""}`}
                  >
                    +
                  </span>
                </button>
                <div
                  className={`overflow-hidden transition-all duration-300 ${openFaq === i ? "max-h-60 opacity-100" : "max-h-0 opacity-0"}`}
                >
                  <p className="px-6 pb-5 text-[15px] leading-relaxed text-[#5b7189] sm:px-8">
                    {item.a}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 11. WHEN DO YOU PAY ── */}
      <section id="fees" className="bg-white px-6 py-12 sm:px-10 sm:py-16">
        <div className="mx-auto max-w-[800px] text-center">
          <h2
            className="text-[24px] font-bold tracking-tight sm:text-[30px]"
            style={{ fontFamily: "var(--font-poppins), sans-serif" }}
          >
            When Do You Pay?
          </h2>
          <p
            className="mt-3 text-[28px] font-extrabold text-[#1c8de0] sm:text-[36px]"
            style={{ fontFamily: "var(--font-poppins), sans-serif" }}
          >
            Nothing Up Front.
          </p>
          <div className="mx-auto mt-6 max-w-[640px] rounded-xl border border-[#12263f]/[0.07] bg-[#f6f8fb] px-6 py-5">
            <p className="text-[13px] leading-relaxed text-[#6b8299]">
              A packaging fee of $1,000 applies for SBA loan preparation and
              lender matching services. This fee may be financed into the loan
              at closing, subject to lender approval. Buddy may also receive a
              referral fee from the selected lender, disclosed on SBA Form 159.
              Buddy does not guarantee loan approval — SBA loan approval is
              subject to lender underwriting, SBA guidelines, and borrower
              eligibility.
            </p>
          </div>
        </div>
      </section>

      {/* ── 12. FINAL CTA ── */}
      <section className="relative overflow-hidden bg-[linear-gradient(160deg,#0e2340_0%,#12263f_100%)] px-6 py-16 text-center text-white sm:px-10 sm:py-24">
        <div
          className="pointer-events-none absolute left-1/2 top-0 h-[400px] w-[600px] -translate-x-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(ellipse, rgba(28,141,224,0.2), transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-[640px]">
          <h2
            className="text-[30px] font-extrabold tracking-tight sm:text-[42px]"
            style={{ fontFamily: "var(--font-poppins), sans-serif" }}
          >
            Ready to Get Started?
          </h2>
          <p className="mx-auto my-5 max-w-[500px] text-[17px] leading-relaxed text-[#b9cbdd] sm:text-[19px]">
            Your complete SBA loan package — built, scored, and matched to
            the right lender. Start in minutes.
          </p>
          <Link
            href="/apply"
            className="inline-flex rounded-xl bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] px-10 py-[17px] text-[17px] font-bold text-white shadow-[0_12px_32px_rgba(28,141,224,0.35)] transition hover:brightness-[1.06]"
          >
            Start your SBA package
          </Link>
        </div>
      </section>

      {/* ── 13. FOOTER ── */}
      <footer className="bg-[#0a1929] px-6 py-10 text-[#8ba1b8] sm:px-10 sm:py-12">
        <div className="mx-auto max-w-[1240px]">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
            <div className="flex items-center gap-3">
              <div
                className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] text-[16px] font-extrabold italic text-white"
                style={{ fontFamily: "var(--font-poppins), sans-serif" }}
              >
                B
              </div>
              <div
                className="text-[17px] font-bold text-white"
                style={{ fontFamily: "var(--font-poppins), sans-serif" }}
              >
                Buddy
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-6 text-[14px]">
              <Link href="/apply" className="transition hover:text-white">
                Start your package
              </Link>
              <Link href="/underwriter" className="transition hover:text-white">
                For lenders
              </Link>
              <a
                href="mailto:hello@buddytheunderwriter.com"
                className="transition hover:text-white"
              >
                Contact
              </a>
            </div>
          </div>
          <div className="mt-8 border-t border-white/[0.08] pt-6 text-center text-[13px] text-[#5b7189]">
            © {new Date().getFullYear()} Buddy. All rights reserved.
          </div>
        </div>
      </footer>
    </main>
  );
}

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
    desc: "Answer simple questions about your business and funding goals.",
  },
  {
    n: 2,
    title: "Upload Documents",
    desc: "Upload your financials and supporting documents securely.",
  },
  {
    n: 3,
    title: "Buddy Reviews Everything",
    desc: "Buddy identifies missing items, analyzes your financials, and organizes your package.",
  },
  {
    n: 4,
    title: "We Build Your SBA Loan Package",
    desc: "Business plan, SBA forms, lender summary, financial analysis, projections, and document checklist.",
  },
  {
    n: 5,
    title: "Get Matched With Qualified SBA Lenders",
    desc: "We connect you with lenders that fit your loan request.",
  },
  {
    n: 6,
    title: "Funding Support",
    desc: "You stay in control while Buddy helps coordinate the process through closing.",
  },
];

const PACKAGE_ITEMS = [
  { title: "Executive Summary", desc: "A clear snapshot of your business and loan request." },
  { title: "Business Plan", desc: "A lender-ready plan that tells your story and your strategy." },
  { title: "Financial Analysis", desc: "Professional analysis of your financials and cash flow." },
  { title: "SBA Forms", desc: "All required SBA forms completed accurately." },
  { title: "Readiness Score", desc: "See how your package stacks up before it reaches lenders." },
  { title: "Complete Lender Package", desc: "A polished package that makes a strong first impression." },
];

const FAQ_ITEMS = [
  {
    q: "How long does it take to build my package?",
    a: "It depends on how quickly you provide your documents and information. Most borrowers complete the process in a few weeks, but your timeline depends on your readiness.",
  },
  {
    q: "What documents do I need?",
    a: "Your last 3 years of business tax returns, recent bank statements, a government-issued ID, and business formation documents. Buddy tells you exactly what's needed as you go.",
  },
  {
    q: "Do you guarantee loan approval?",
    a: "No. Buddy does not guarantee loan approval. SBA loan approval is subject to lender underwriting, SBA guidelines, and borrower eligibility. Buddy prepares a strong, complete package to give your application the best possible presentation.",
  },
  {
    q: "When do I pay?",
    a: "A packaging fee of $1,000 applies for SBA loan preparation and lender matching services. This fee may be financed into the loan at closing, subject to lender approval. Buddy may also receive a referral fee from the selected lender, disclosed on SBA Form 159.",
  },
  {
    q: "What if I don't finish my application?",
    a: "No problem. Your progress is saved and you can pick up where you left off at any time. There is no fee unless your loan is approved and funded.",
  },
  {
    q: "What types of SBA financing does Buddy support?",
    a: "SBA 7(a) and 504 loans — acquisitions, expansions, equipment, real estate, working capital, and franchise financing.",
  },
  {
    q: "Can Buddy help with a business acquisition or franchise?",
    a: "Yes. Buddy supports business acquisitions, franchise purchases, expansions, equipment financing, commercial real estate, and working capital loans through SBA 7(a) and 504 programs.",
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
            <h1
              className="text-[32px] font-extrabold leading-[1.08] tracking-tight sm:text-[48px] lg:text-[52px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Build a Lender-Ready SBA Loan Package
            </h1>
            <p
              className="mt-2 text-[26px] font-extrabold text-[#4db8f0] sm:text-[36px] lg:text-[40px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Right the First Time.
            </p>
            <p className="mb-8 mt-5 max-w-[540px] text-[17px] leading-relaxed text-[#b9cbdd] sm:text-[19px]">
              Buddy guides you step-by-step, organizes your documents, builds a
              professional SBA loan package, and prepares everything before it
              reaches a lender.
            </p>
            <div className="flex flex-wrap gap-3.5">
              <Link
                href="/apply"
                className="rounded-xl bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] px-7 py-[15px] text-[16px] font-bold text-white shadow-[0_10px_28px_rgba(28,141,224,0.4)] transition hover:brightness-[1.06]"
              >
                Start Your SBA Package
              </Link>
              <a
                href="#how"
                className="rounded-xl border border-white/[0.18] bg-white/[0.08] px-7 py-[15px] text-[16px] font-bold text-white transition hover:bg-white/[0.14]"
              >
                See How Buddy Works
              </a>
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

      {/* ── TRUST STRIP ── */}
      <section className="border-b border-[#12263f]/[0.07] bg-white px-6 py-6 sm:px-10">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-center gap-x-10 gap-y-4">
          {[
            {
              label: "Built to SBA Standards",
              icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              ),
            },
            {
              label: "Bank-Ready Documentation",
              icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ),
            },
            {
              label: "No Guesswork. No Paper Chase.",
              icon: (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              ),
            },
          ].map((t) => (
            <div key={t.label} className="flex items-center gap-2 text-[14px] font-semibold text-[#3d5674]">
              <span className="text-[#1c8de0]">{t.icon}</span>
              {t.label}
            </div>
          ))}
        </div>
      </section>

      {/* ── 3. DESIGNED FOR SBA FINANCING ── */}
      <section className="px-6 py-16 sm:px-10 sm:py-24">
        <div className="mx-auto max-w-[1240px]">
          <div className="mx-auto mb-12 max-w-[660px] text-center">
            <h2
              className="mb-3 text-[26px] font-bold tracking-tight sm:text-[36px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Designed for SBA Financing
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "SBA 7(a)", icon: "🏦" },
              { label: "SBA 504", icon: "🏗️" },
              { label: "Business Acquisition", icon: "🤝" },
              { label: "Commercial Real Estate", icon: "🏢" },
              { label: "Working Capital", icon: "💼" },
              { label: "Equipment Financing", icon: "⚙️" },
              { label: "Business Expansion", icon: "📈" },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center gap-3 rounded-xl border border-[#12263f]/[0.07] bg-white px-5 py-4 text-[15px] font-semibold text-[#12263f]"
              >
                <span className="text-[20px]">{item.icon}</span>
                {item.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 4. HOW BUDDY WORKS ── */}
      <section id="how" className="bg-white px-6 py-16 sm:px-10 sm:py-24">
        <div className="mx-auto max-w-[1240px]">
          <div className="mx-auto mb-14 max-w-[660px] text-center">
            <h2
              className="mb-3 text-[28px] font-bold tracking-tight sm:text-[38px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              How Buddy Works
            </h2>
            <p className="text-[16px] leading-relaxed text-[#5b7189] sm:text-[17px]">
              Six simple steps to a stronger SBA loan package.
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
          <div className="mx-auto mb-14 max-w-[700px] text-center">
            <h2
              className="mb-3 text-[26px] font-bold tracking-tight sm:text-[36px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Everything Your SBA Lender Wants... Built Automatically.
            </h2>
            <p className="text-[16px] leading-relaxed text-[#5b7189] sm:text-[17px]">
              A complete, organized package—ready for underwriting.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            <h2
              className="mb-3 text-[26px] font-bold tracking-tight sm:text-[36px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Why Business Owners Choose Buddy
            </h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Save Weeks of Work",
                desc: "We handle the heavy lifting so you can focus on your business.",
              },
              {
                title: "Never Wonder What's Missing",
                desc: "Buddy checks for gaps before your package reaches a lender.",
              },
              {
                title: "Bank-Ready Packages",
                desc: "Everything is organized the way lenders want it.",
              },
              {
                title: "Expert Guidance",
                desc: "Buddy guides you from start to finish.",
              },
              {
                title: "Higher Confidence Before Applying",
                desc: "Know your package is strong before it hits a lender's desk.",
              },
            ].map((b) => (
              <div
                key={b.title}
                className="rounded-2xl border border-[#12263f]/[0.07] bg-[#f6f8fb] p-7 transition hover:-translate-y-1 hover:shadow-[0_12px_30px_rgba(18,38,63,0.08)]"
              >
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[#1c8de0]/[0.1] text-[#1c8de0]">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <h3
                  className="mb-2 text-[18px] font-bold tracking-tight"
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
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Cleaner Applications",
                desc: "Complete, well-structured packages every time.",
              },
              {
                title: "Better Organized Files",
                desc: "Everything is easy to find and review.",
              },
              {
                title: "Faster Reviews",
                desc: "Less back-and-forth. Faster underwriting.",
              },
              {
                title: "Reduced Back-and-Forth",
                desc: "More accurate information up front.",
              },
              {
                title: "Better Qualified Borrowers",
                desc: "Stronger packages from day one.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-white/[0.1] bg-white/[0.06] p-7 transition hover:bg-white/[0.1]"
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
            <h2
              className="mb-3 text-[26px] font-bold tracking-tight sm:text-[36px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Built for Trust. Designed for Security.
            </h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              {
                title: "Secure Document Handling",
                desc: "Your documents are encrypted in transit and at rest. Direct-to-storage uploads keep your files protected.",
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                ),
              },
              {
                title: "Role-Based Access Controls",
                desc: "Your information is only visible to the people who need it, when they need it. You control who sees your data.",
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                ),
              },
              {
                title: "Audit & Event History",
                desc: "Every action is recorded. An event history tracks decisions, documents, and data points from start to finish.",
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
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
          <p className="mt-8 text-center text-[14px] text-[#6b8299]">
            Buddy is not a lender. We do not make loan decisions.
          </p>
        </div>
      </section>

      {/* ── 9. SEE WHAT BUDDY ACTUALLY BUILDS ── */}
      <section className="bg-white px-6 py-16 sm:px-10 sm:py-24">
        <div className="mx-auto max-w-[1240px]">
          <div className="mx-auto mb-14 max-w-[660px] text-center">
            <h2
              className="mb-3 text-[26px] font-bold tracking-tight sm:text-[36px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              See What Buddy Actually Builds
            </h2>
            <p className="text-[16px] leading-relaxed text-[#5b7189] sm:text-[17px]">
              Real documents. Real quality. Ready for underwriting.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "Business Plan" },
              { title: "Executive Summary" },
              { title: "Financial Analysis" },
              { title: "SBA Forms" },
              { title: "Cash Flow Projections" },
              { title: "Lender Package" },
            ].map((doc) => (
              <div
                key={doc.title}
                className="rounded-2xl border border-[#12263f]/[0.07] bg-[#f6f8fb] p-6"
              >
                <div className="mb-4 flex h-28 items-center justify-center rounded-xl bg-white border border-[#12263f]/[0.05]">
                  <div className="text-center">
                    <div className="mb-1 text-[14px] font-bold text-[#12263f]">{doc.title}</div>
                    <div className="text-[11px] text-[#6b8299]">Sample preview</div>
                  </div>
                </div>
                <h3 className="text-[15px] font-bold text-[#12263f]">{doc.title}</h3>
              </div>
            ))}
          </div>
          <div className="mt-10 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-lg border-2 border-[#22c55e] bg-[#22c55e]/[0.08] px-6 py-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span
                className="text-[16px] font-extrabold tracking-wide text-[#22c55e]"
                style={{ fontFamily: "var(--font-poppins), sans-serif" }}
              >
                READY FOR UNDERWRITING
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── 10. FAQ ── */}
      <section className="px-6 py-16 sm:px-10 sm:py-24">
        <div className="mx-auto max-w-[800px]">
          <div className="mb-12 text-center">
            <h2
              className="mb-3 text-[26px] font-bold tracking-tight sm:text-[36px]"
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
      <section className="relative overflow-hidden bg-[linear-gradient(160deg,#0e2340_0%,#12263f_100%)] px-6 py-16 text-white sm:px-10 sm:py-24">
        <div
          className="pointer-events-none absolute left-1/2 top-0 h-[400px] w-[600px] -translate-x-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(ellipse, rgba(28,141,224,0.2), transparent 70%)",
          }}
        />
        <div className="relative mx-auto flex max-w-[1240px] flex-col items-center gap-10 lg:flex-row lg:justify-between">
          <div className="text-center lg:text-left">
            <h2
              className="text-[30px] font-extrabold tracking-tight sm:text-[42px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Let&apos;s Build Your SBA Loan Package.
            </h2>
            <p className="my-5 max-w-[500px] text-[17px] leading-relaxed text-[#b9cbdd] sm:text-[19px]">
              Start your package and let Buddy guide you from application to
              lender-ready.
            </p>
            <Link
              href="/apply"
              className="inline-flex rounded-xl bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] px-10 py-[17px] text-[17px] font-bold text-white shadow-[0_12px_32px_rgba(28,141,224,0.35)] transition hover:brightness-[1.06]"
            >
              Start Your SBA Package
            </Link>
          </div>
          <div className="hidden w-[280px] shrink-0 lg:block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/buddy-robot.png"
              alt="Buddy the SBA Underwriter"
              className="w-full rounded-2xl opacity-90"
            />
          </div>
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

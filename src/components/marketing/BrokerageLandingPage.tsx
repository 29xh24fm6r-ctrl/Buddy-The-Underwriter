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

const pp: React.CSSProperties = {
  fontFamily: "var(--font-poppins), sans-serif",
};

const STEPS = [
  {
    n: 1,
    title: "Tell Buddy About Your Business",
    desc: "Answer simple questions about your business and funding goals.",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      </svg>
    ),
  },
  {
    n: 2,
    title: "Upload Documents",
    desc: "Upload your financials and supporting documents securely.",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 16 12 12 8 16" />
        <line x1="12" y1="12" x2="12" y2="21" />
        <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
      </svg>
    ),
  },
  {
    n: 3,
    title: "Buddy Reviews Everything",
    desc: "Buddy identifies missing items, analyzes your financials, and organizes your package.",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    n: 4,
    title: "We Build Your SBA Loan Package",
    desc: "Business plan, SBA forms, financial analysis, projections, and a complete checklist.",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    n: 5,
    title: "Get Matched With Qualified SBA Lenders",
    desc: "We connect you with lenders that fit your loan request.",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    n: 6,
    title: "Funding Support",
    desc: "You stay in control while Buddy helps coordinate the process through closing.",
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
];

const PACKAGE_ITEMS = [
  {
    title: "Executive Summary",
    desc: "Clear overview of your business, goals, and loan request.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
  {
    title: "Business Plan",
    desc: "Lender-ready plan with market, strategy, and operations.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    title: "Financial Analysis",
    desc: "In-depth review of your financials and key metrics.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    title: "SBA Forms",
    desc: "All required SBA forms completed and organized.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <path d="M9 15l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "Readiness Score",
    desc: "See how lender-ready your package is before you apply.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
  },
  {
    title: "Complete Lender Package",
    desc: "All documents compiled in a professional, easy-to-review package.",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
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

const OWNER_BENEFITS = [
  { title: "Save Weeks of Work", desc: "Buddy does the heavy lifting." },
  { title: "Never Wonder What's Missing", desc: "We show you exactly what lenders need." },
  { title: "Bank-Ready Packages", desc: "Professionally prepared and easy to review." },
  { title: "Expert Guidance", desc: "Built from real SBA lending experience." },
  { title: "Higher Confidence Before Applying", desc: "Know your package is complete and strong." },
];

const LENDER_BENEFITS = [
  { title: "Cleaner Applications", desc: "Organized, complete, and easy to review." },
  { title: "Better Organized Files", desc: "Everything in the right place." },
  { title: "Faster Reviews", desc: "Spend less time chasing information." },
  { title: "Reduced Back-and-Forth", desc: "Fewer requests. Fewer delays." },
  { title: "Better Qualified Borrowers", desc: "Stronger packages from the start." },
];

const SBA_TYPES = [
  {
    label: "SBA 7(a)",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21h18" />
        <path d="M3 10h18" />
        <path d="M5 6l7-3 7 3" />
        <line x1="4" y1="10" x2="4" y2="21" />
        <line x1="20" y1="10" x2="20" y2="21" />
        <line x1="8" y1="14" x2="8" y2="17" />
        <line x1="12" y1="14" x2="12" y2="17" />
        <line x1="16" y1="14" x2="16" y2="17" />
      </svg>
    ),
  },
  {
    label: "SBA 504",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="6" width="15" height="16" rx="2" />
        <rect x="8" y="2" width="15" height="16" rx="2" />
      </svg>
    ),
  },
  {
    label: "Business Acquisition",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    label: "Commercial Real Estate",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <line x1="9" y1="6" x2="9.01" y2="6" />
        <line x1="15" y1="6" x2="15.01" y2="6" />
        <line x1="9" y1="10" x2="9.01" y2="10" />
        <line x1="15" y1="10" x2="15.01" y2="10" />
        <line x1="9" y1="14" x2="9.01" y2="14" />
        <line x1="15" y1="14" x2="15.01" y2="14" />
        <path d="M9 18h6" />
      </svg>
    ),
  },
  {
    label: "Working Capital",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    label: "Equipment Financing",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    label: "Business Expansion",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
  },
];

export function BrokerageLandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  return (
    <main
      className={`${poppins.variable} ${jakarta.variable} min-h-screen bg-[#f8fafc] text-[#12263f] antialiased`}
      style={{ fontFamily: "var(--font-jakarta), sans-serif" }}
    >
      {/* ────────────────────────────────────────────────────────────────
          1. NAVIGATION
      ──────────────────────────────────────────────────────────────── */}
      <nav className="border-b border-black/[0.06] bg-white">
        <div className="mx-auto flex h-[68px] max-w-[1200px] items-center justify-between px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <div
              className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] text-[18px] font-extrabold italic text-white shadow-[0_2px_8px_rgba(28,141,224,0.3)]"
              style={pp}
            >
              B
            </div>
            <div className="leading-none">
              <div className="text-[18px] font-bold text-[#12263f]" style={pp}>
                Buddy
              </div>
              <div className="text-[7.5px] font-bold uppercase tracking-[2.2px] text-[#6b8299]">
                The SBA Underwriter
              </div>
            </div>
          </Link>

          <div className="hidden items-center gap-7 lg:flex">
            {[
              { label: "How It Works", href: "#how" },
              { label: "What Buddy Builds", href: "#package" },
              { label: "For Lenders", href: "#lenders" },
              { label: "FAQ", href: "#faq" },
              { label: "Sign In", href: "/welcome-back" },
            ].map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-[14px] font-semibold text-[#3d5674] transition-colors hover:text-[#1c8de0]"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/apply"
              className="rounded-full bg-gradient-to-r from-[#1c8de0] to-[#3ba4f0] px-6 py-2.5 text-[14px] font-bold text-white shadow-[0_4px_14px_rgba(28,141,224,0.35)] transition hover:shadow-[0_6px_20px_rgba(28,141,224,0.45)] hover:brightness-[1.04]"
            >
              Start Your SBA Package
            </Link>
            <button
              onClick={() => setNavOpen(!navOpen)}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-[#3d5674] transition hover:bg-[#f1f5f9] lg:hidden"
              aria-label="Menu"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {navOpen ? (
                  <>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </>
                ) : (
                  <>
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>

        {navOpen && (
          <div className="border-t border-black/[0.06] bg-white px-6 pb-4 pt-2 lg:hidden">
            {[
              { label: "How It Works", href: "#how" },
              { label: "What Buddy Builds", href: "#package" },
              { label: "For Lenders", href: "#lenders" },
              { label: "FAQ", href: "#faq" },
              { label: "Sign In", href: "/welcome-back" },
            ].map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setNavOpen(false)}
                className="block py-2.5 text-[15px] font-semibold text-[#3d5674] transition hover:text-[#1c8de0]"
              >
                {link.label}
              </a>
            ))}
          </div>
        )}
      </nav>

      {/* ────────────────────────────────────────────────────────────────
          2. HERO
      ──────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[linear-gradient(135deg,#0b1a2e_0%,#12263f_50%,#162d4a_100%)]">
        <div
          className="pointer-events-none absolute right-0 top-0 h-full w-1/2"
          style={{ background: "radial-gradient(ellipse at 70% 50%, rgba(28,141,224,0.12), transparent 70%)" }}
        />
        <div className="relative mx-auto grid max-w-[1200px] items-center gap-10 px-6 py-16 sm:py-20 lg:grid-cols-[1fr_1fr] lg:gap-12 lg:px-8 lg:py-24">
          <div className="max-w-[560px]">
            <h1
              className="text-[36px] font-extrabold leading-[1.06] tracking-tight text-white sm:text-[48px] lg:text-[56px]"
              style={pp}
            >
              Build a Lender-Ready
              <br />
              SBA Loan Package
            </h1>
            <p
              className="mt-3 text-[28px] font-extrabold italic text-[#4db8f0] sm:text-[36px] lg:text-[42px]"
              style={pp}
            >
              Right the First Time.
            </p>
            <p className="mb-9 mt-6 max-w-[480px] text-[16px] leading-[1.7] text-[#94a8bf] sm:text-[17px]">
              Buddy guides you step-by-step, organizes your documents, builds a
              professional SBA loan package, and prepares everything before it
              reaches a lender.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Link
                href="/apply"
                className="rounded-full bg-gradient-to-r from-[#1c8de0] to-[#3ba4f0] px-8 py-[14px] text-[15px] font-bold text-white shadow-[0_8px_24px_rgba(28,141,224,0.4)] transition hover:shadow-[0_12px_32px_rgba(28,141,224,0.5)] hover:brightness-[1.04]"
              >
                Start Your SBA Package
              </Link>
              <a
                href="#how"
                className="group flex items-center gap-2.5 rounded-full border border-white/[0.18] bg-white/[0.06] px-7 py-[13px] text-[15px] font-bold text-white transition hover:bg-white/[0.12]"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-white/80">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                  <polygon points="10,8 16,12 10,16" fill="currentColor" />
                </svg>
                See How Buddy Works
              </a>
            </div>

            <div className="mt-12 flex flex-wrap items-center gap-6 sm:gap-8">
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
                <div key={t.label} className="flex items-center gap-2">
                  <span className="text-[#4db8f0]">{t.icon}</span>
                  <span className="text-[12px] font-semibold text-[#7b95ad] sm:text-[13px]">{t.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative hidden lg:flex lg:justify-end">
            <div className="relative">
              <div
                className="absolute -inset-6 rounded-3xl"
                style={{ background: "radial-gradient(ellipse at center, rgba(28,141,224,0.18), transparent 70%)" }}
              />
              <div className="relative overflow-hidden rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.4)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/buddy-robot-hero.png"
                  alt="Buddy the SBA Underwriter — loan packaging dashboard"
                  className="block w-full max-w-[520px]"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          3. DESIGNED FOR SBA FINANCING
      ──────────────────────────────────────────────────────────────── */}
      <section id="financing" className="px-6 py-20 sm:py-24 lg:px-8">
        <div className="mx-auto max-w-[1200px]">
          <div className="mx-auto mb-14 max-w-[600px] text-center">
            <h2 className="text-[22px] font-bold uppercase tracking-[1.5px] sm:text-[28px]" style={pp}>
              Designed for SBA Financing
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[#5b7189] sm:text-[16px]">
              Buddy supports the most common SBA loan types and business goals.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-7">
            {SBA_TYPES.map((item) => (
              <div
                key={item.label}
                className="group flex flex-col items-center gap-3 rounded-2xl border border-[#e2e8f0] bg-white px-4 py-6 text-center transition hover:-translate-y-1 hover:border-[#1c8de0]/20 hover:shadow-[0_8px_24px_rgba(28,141,224,0.08)]"
              >
                <div className="text-[#1c8de0] transition group-hover:scale-110">
                  {item.icon}
                </div>
                <span className="text-[13px] font-bold leading-tight text-[#12263f]" style={pp}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          4. HOW BUDDY WORKS
      ──────────────────────────────────────────────────────────────── */}
      <section id="how" className="bg-white px-6 py-20 sm:py-24 lg:px-8">
        <div className="mx-auto max-w-[1200px]">
          <div className="mx-auto mb-16 max-w-[600px] text-center">
            <h2 className="text-[22px] font-bold uppercase tracking-[1.5px] sm:text-[28px]" style={pp}>
              How Buddy Works
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[#5b7189] sm:text-[16px]">
              Six simple steps to a stronger SBA loan package.
            </p>
          </div>

          <div className="relative">
            <div className="absolute left-0 right-0 top-[68px] hidden h-[2px] bg-gradient-to-r from-transparent via-[#e2e8f0] to-transparent lg:block" />
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-6 lg:gap-5">
              {STEPS.map((s) => (
                <div key={s.n} className="relative flex flex-col items-center text-center">
                  <div className="mb-3 text-[#1c8de0]">{s.icon}</div>
                  <div
                    className="relative z-10 mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-[#16a34a] text-[16px] font-bold text-white shadow-[0_3px_10px_rgba(22,163,74,0.3)]"
                    style={pp}
                  >
                    {s.n}
                  </div>
                  <h3 className="mb-2 text-[14px] font-bold leading-tight text-[#12263f]" style={pp}>
                    {s.title}
                  </h3>
                  <p className="text-[13px] leading-relaxed text-[#5b7189]">
                    {s.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          5. EVERYTHING YOUR SBA LENDER WANTS
      ──────────────────────────────────────────────────────────────── */}
      <section id="package" className="px-6 py-20 sm:py-24 lg:px-8">
        <div className="mx-auto max-w-[1200px]">
          <div className="mx-auto mb-14 max-w-[700px] text-center">
            <h2 className="text-[20px] font-bold uppercase tracking-[1.5px] sm:text-[26px] lg:text-[28px]" style={pp}>
              Everything Your SBA Lender Wants... Built Automatically.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[#5b7189] sm:text-[16px]">
              A complete, organized package—ready for underwriting.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {PACKAGE_ITEMS.map((item) => (
              <div
                key={item.title}
                className="group rounded-2xl border border-[#e2e8f0] bg-white p-7 transition hover:-translate-y-1 hover:border-[#1c8de0]/20 hover:shadow-[0_12px_32px_rgba(28,141,224,0.08)]"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#eef6ff] text-[#1c8de0] transition group-hover:bg-[#1c8de0]/[0.15]">
                  {item.icon}
                </div>
                <h3 className="mb-2 text-[16px] font-bold text-[#12263f]" style={pp}>
                  {item.title}
                </h3>
                <p className="text-[14px] leading-relaxed text-[#5b7189]">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          6. READY FOR UNDERWRITING — DOCUMENT VISUAL
      ──────────────────────────────────────────────────────────────── */}
      <section className="overflow-hidden bg-gradient-to-b from-[#f0f4f8] to-[#e8eef4] px-6 py-10 sm:py-12 lg:px-8">
        <div className="mx-auto max-w-[1200px]">
          <div className="relative mx-auto flex h-[220px] max-w-[700px] items-center justify-center sm:h-[280px]">
            {/* Back card — Business Plan page */}
            <div className="absolute h-[180px] w-[300px] rotate-[-8deg] rounded-lg bg-white shadow-[0_8px_32px_rgba(0,0,0,0.1)] sm:h-[220px] sm:w-[380px]" style={{ fontSize: 0 }}>
              <div className="p-4" style={{ fontSize: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#1e3a5f", marginBottom: 6 }}>Business Plan</div>
                <div style={{ fontSize: 7, color: "#64748b", lineHeight: "1.5", marginBottom: 4 }}>1. Executive Summary</div>
                <div style={{ fontSize: 6, color: "#94a3b8", lineHeight: "1.4", marginBottom: 3 }}>The company was founded in 2019 and operates in the commercial services sector...</div>
                <div style={{ fontSize: 7, color: "#64748b", lineHeight: "1.5", marginBottom: 4 }}>2. Market Analysis</div>
                <div style={{ fontSize: 6, color: "#94a3b8", lineHeight: "1.4" }}>Total addressable market estimated at $4.2B with projected 12% CAGR through 2028.</div>
              </div>
            </div>
            {/* Middle card — Financial Summary */}
            <div className="absolute h-[180px] w-[300px] rotate-[-3deg] rounded-lg bg-white shadow-[0_12px_40px_rgba(0,0,0,0.12)] sm:h-[220px] sm:w-[380px]" style={{ fontSize: 0 }}>
              <div className="p-4" style={{ fontSize: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#1e3a5f", marginBottom: 6 }}>Financial Summary</div>
                <div className="mb-2 grid grid-cols-3 gap-2">
                  <div className="rounded bg-[#f0f7ff] p-1.5 text-center">
                    <div style={{ fontSize: 6, color: "#64748b" }}>Revenue</div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#1c8de0" }}>$1.2M</div>
                  </div>
                  <div className="rounded bg-[#f0fdf4] p-1.5 text-center">
                    <div style={{ fontSize: 6, color: "#64748b" }}>Net Income</div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#16a34a" }}>$340K</div>
                  </div>
                  <div className="rounded bg-[#faf5ff] p-1.5 text-center">
                    <div style={{ fontSize: 6, color: "#64748b" }}>DSCR</div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#7c3aed" }}>1.42x</div>
                  </div>
                </div>
                <div className="flex items-end gap-1.5" style={{ height: 32 }}>
                  <div className="w-4 rounded-t bg-[#bfdbfe]" style={{ height: "45%" }} />
                  <div className="w-4 rounded-t bg-[#93c5fd]" style={{ height: "60%" }} />
                  <div className="w-4 rounded-t bg-[#60a5fa]" style={{ height: "85%" }} />
                  <div className="w-4 rounded-t bg-[#3b82f6]" style={{ height: "100%" }} />
                  <div className="w-4 rounded-t bg-[#60a5fa]" style={{ height: "70%" }} />
                </div>
              </div>
            </div>
            {/* Front card — SBA Application */}
            <div className="absolute h-[180px] w-[300px] rotate-[2deg] rounded-lg bg-white shadow-[0_16px_48px_rgba(0,0,0,0.14)] sm:h-[220px] sm:w-[380px]" style={{ fontSize: 0 }}>
              <div className="p-4" style={{ fontSize: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#1e3a5f", marginBottom: 6 }}>SBA 7(a) Loan Application</div>
                <div className="mb-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
                  <div>
                    <div style={{ fontSize: 6, color: "#94a3b8" }}>Loan Amount</div>
                    <div style={{ fontSize: 8, fontWeight: 600, color: "#334155" }}>$350,000</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 6, color: "#94a3b8" }}>Term</div>
                    <div style={{ fontSize: 8, fontWeight: 600, color: "#334155" }}>10 Years</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 6, color: "#94a3b8" }}>Business Name</div>
                    <div style={{ fontSize: 8, fontWeight: 600, color: "#334155" }}>Acme Services LLC</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 6, color: "#94a3b8" }}>NAICS Code</div>
                    <div style={{ fontSize: 8, fontWeight: 600, color: "#334155" }}>541611</div>
                  </div>
                </div>
                <div className="mt-2 rounded bg-[#f0fdf4] px-2 py-1">
                  <div style={{ fontSize: 7, fontWeight: 600, color: "#16a34a" }}>Status: Complete - All documents verified</div>
                </div>
              </div>
            </div>
            <div
              className="absolute z-20 rounded-md bg-[#16a34a] px-10 py-3 shadow-[0_4px_20px_rgba(22,163,74,0.4)] sm:px-14 sm:py-4"
              style={{ transform: "rotate(-12deg)" }}
            >
              <span className="text-[16px] font-extrabold tracking-[2px] text-white sm:text-[20px]" style={pp}>
                READY FOR UNDERWRITING
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          7-8. WHY BUSINESS OWNERS + WHY SBA LENDERS
      ──────────────────────────────────────────────────────────────── */}
      <section
        id="lenders"
        data-section="bank-platform-entry"
        className="px-6 py-20 sm:py-24 lg:px-8"
      >
        <div className="mx-auto max-w-[1200px]">
          <div className="grid items-stretch gap-6 lg:grid-cols-[1fr_auto_1fr] lg:gap-0">
            <div className="rounded-2xl bg-[#f0fdf4] p-8 sm:p-10 lg:rounded-r-none">
              <h3
                className="mb-8 text-[18px] font-bold uppercase tracking-[1.2px] text-[#12263f] sm:text-[20px]"
                style={pp}
              >
                Why Business Owners
                <br />
                Choose Buddy
              </h3>
              <div className="space-y-5">
                {OWNER_BENEFITS.map((b) => (
                  <div key={b.title} className="flex gap-3">
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#16a34a]">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-[14px] font-bold text-[#12263f]">{b.title}</div>
                      <div className="text-[13px] text-[#5b7189]">{b.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative hidden w-[220px] items-end justify-center overflow-hidden lg:flex">
              <div className="absolute inset-0 bg-gradient-to-b from-[#f0fdf4] via-[#f4f8fb] to-[#eef6ff]" />
              <div className="relative z-10 w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/buddy-robot.png"
                  alt="Buddy the SBA Underwriter"
                  className="w-full object-contain object-bottom"
                />
                <div className="absolute bottom-[40%] left-1/2 -translate-x-1/2 rotate-[-8deg] rounded bg-[#16a34a] px-2 py-1 shadow-md">
                  <span className="whitespace-nowrap text-[8px] font-extrabold tracking-[1px] text-white" style={pp}>
                    READY FOR UNDERWRITING
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-[#eef6ff] p-8 sm:p-10 lg:rounded-l-none">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-[1.5px] text-[#1c8de0]">
                For SBA lenders
              </div>
              <h3
                className="mb-8 text-[18px] font-bold uppercase tracking-[1.2px] text-[#12263f] sm:text-[20px]"
                style={pp}
              >
                Why SBA Lenders
                <br />
                Love Buddy
              </h3>
              <div className="space-y-5">
                {LENDER_BENEFITS.map((b) => (
                  <div key={b.title} className="flex gap-3">
                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1c8de0]">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-[14px] font-bold text-[#12263f]">{b.title}</div>
                      <div className="text-[13px] text-[#5b7189]">{b.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-8">
                <Link
                  href="/underwriter"
                  className="inline-flex items-center gap-2 text-[14px] font-bold text-[#1c8de0] transition hover:text-[#0e6fc0]"
                >
                  Explore the banking platform
                  <span aria-hidden="true">&rarr;</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          9. BUILT FOR TRUST
      ──────────────────────────────────────────────────────────────── */}
      <section className="bg-white px-6 py-20 sm:py-24 lg:px-8">
        <div className="mx-auto max-w-[1200px]">
          <div className="mx-auto mb-14 max-w-[600px] text-center">
            <h2 className="text-[20px] font-bold uppercase tracking-[1.5px] sm:text-[26px]" style={pp}>
              Built for Trust. Designed for Security.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[#5b7189] sm:text-[16px]">
              Your information is protected every step of the way.
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr_1fr_1fr_1.2fr]">
            {[
              {
                title: "Secure Document Handling",
                desc: "Encrypted uploads and secure storage.",
                icon: (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                ),
              },
              {
                title: "Role-Based Access",
                desc: "Only authorized people see your information.",
                icon: (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                ),
              },
              {
                title: "Controlled Sharing",
                desc: "You decide what lenders can see.",
                icon: (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                ),
              },
              {
                title: "Audit & Event History",
                desc: "Complete activity logs and audit trail.",
                icon: (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                ),
              },
            ].map((item) => (
              <div key={item.title} className="text-center lg:text-left">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[#0e2340] text-[#4db8f0] lg:mx-0">
                  {item.icon}
                </div>
                <h4 className="mb-1 text-[14px] font-bold text-[#12263f]" style={pp}>
                  {item.title}
                </h4>
                <p className="text-[13px] leading-relaxed text-[#5b7189]">{item.desc}</p>
              </div>
            ))}
            <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] p-6 sm:p-7">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#1c8de0]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p className="mb-2 text-[15px] font-bold leading-snug text-[#12263f]" style={pp}>
                Buddy is not a lender.<br />We do not make loan decisions.
              </p>
              <p className="text-[12px] leading-relaxed text-[#6b8299]">
                Loan approval is subject to lender underwriting, SBA guidelines, and borrower eligibility.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          10. SEE WHAT BUDDY ACTUALLY BUILDS
      ──────────────────────────────────────────────────────────────── */}
      <section className="bg-gradient-to-b from-[#f0f4f8] to-[#e8eef4] px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="mx-auto max-w-[1200px]">
          <img
            src="/images/buddy-what-we-build.png"
            alt="Examples of the SBA loan package documents Buddy builds, including a business plan, executive summary, financial analysis, SBA forms, cash flow projections, and lender-ready package."
            className="w-full"
            style={{ maxWidth: "100%", height: "auto" }}
          />
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          11-12. FAQ + WHEN DO YOU PAY
      ──────────────────────────────────────────────────────────────── */}
      <section id="faq" className="px-6 py-20 sm:py-24 lg:px-8">
        <div className="mx-auto grid max-w-[1200px] gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
          <div>
            <h2 className="mb-8 text-[20px] font-bold uppercase tracking-[1.5px] sm:text-[24px]" style={pp}>
              Frequently Asked Questions
            </h2>
            <div className="divide-y divide-[#e2e8f0] rounded-2xl border border-[#e2e8f0] bg-white">
              {FAQ_ITEMS.map((item, i) => (
                <div key={i}>
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="flex w-full items-center justify-between px-6 py-4 text-left transition hover:bg-[#f8fafc]"
                  >
                    <span className="pr-4 text-[14px] font-semibold text-[#12263f] sm:text-[15px]">
                      {item.q}
                    </span>
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#94a3b8"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`shrink-0 transition-transform duration-200 ${openFaq === i ? "rotate-180" : ""}`}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-300 ${openFaq === i ? "max-h-48 opacity-100" : "max-h-0 opacity-0"}`}
                  >
                    <p className="px-6 pb-5 text-[14px] leading-relaxed text-[#5b7189]">
                      {item.a}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div id="fees" className="lg:pt-14">
            <h2 className="mb-2 text-[18px] font-bold uppercase tracking-[1.5px] sm:text-[22px]" style={pp}>
              When Do You Pay?
            </h2>
            <p
              className="mb-6 text-[32px] font-extrabold italic text-[#1c8de0] sm:text-[40px]"
              style={pp}
            >
              Nothing Up Front.
            </p>
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-6">
              <p className="mb-4 text-[13px] leading-[1.8] text-[#5b7189]">
                A packaging fee of $1,000 applies for SBA loan preparation and
                lender matching services. This fee may be financed into the loan
                at closing, subject to lender approval. Buddy may also receive a
                referral fee from the selected lender, disclosed on SBA Form 159.
              </p>
              <p className="text-[13px] leading-[1.8] text-[#5b7189]">
                Buddy does not guarantee loan approval. SBA loan approval is
                subject to lender underwriting, SBA guidelines, and borrower
                eligibility.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          13. FINAL CTA
      ──────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[linear-gradient(135deg,#0e2340_0%,#12263f_100%)] px-6 py-16 text-white sm:py-20 lg:px-8">
        <div
          className="pointer-events-none absolute left-1/3 top-0 h-full w-2/3"
          style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(28,141,224,0.1), transparent 70%)" }}
        />
        <div className="relative mx-auto flex max-w-[1200px] items-center justify-between gap-10">
          <div className="max-w-[560px]">
            <h2
              className="text-[28px] font-extrabold tracking-tight sm:text-[36px] lg:text-[40px]"
              style={pp}
            >
              Let&apos;s Build Your SBA Loan Package.
            </h2>
            <p className="my-5 max-w-[440px] text-[16px] leading-relaxed text-[#94a8bf] sm:text-[17px]">
              Start your package and let Buddy guide you from application to
              lender-ready.
            </p>
            <Link
              href="/apply"
              className="inline-flex rounded-full bg-gradient-to-r from-[#1c8de0] to-[#3ba4f0] px-10 py-[15px] text-[15px] font-bold text-white shadow-[0_8px_28px_rgba(28,141,224,0.4)] transition hover:shadow-[0_12px_36px_rgba(28,141,224,0.5)] hover:brightness-[1.04]"
            >
              Start Your SBA Package
            </Link>
          </div>
          <div className="hidden w-[440px] shrink-0 lg:block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/buddy-robot.png"
              alt="Buddy the SBA Underwriter"
              className="w-full rounded-xl opacity-90"
            />
          </div>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────────
          14. FOOTER
      ──────────────────────────────────────────────────────────────── */}
      <footer className="bg-[#0a1929] px-6 pb-8 pt-14 text-[#8ba1b8] lg:px-8">
        <div className="mx-auto max-w-[1200px]">
          <div className="mb-10 grid gap-10 sm:grid-cols-2 lg:grid-cols-5 lg:gap-8">
            <div className="lg:col-span-1">
              <div className="mb-3 flex items-center gap-2.5">
                <div
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-lg bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] text-[14px] font-extrabold italic text-white"
                  style={pp}
                >
                  B
                </div>
                <div>
                  <div className="text-[15px] font-bold text-white" style={pp}>Buddy</div>
                  <div className="text-[7px] font-bold uppercase tracking-[2px] text-[#5b7189]">
                    The SBA Underwriter
                  </div>
                </div>
              </div>
              <p className="text-[12px] leading-relaxed text-[#5b7189]">
                We build lender-ready SBA loan packages so you can focus on your business.
              </p>
            </div>

            <div>
              <h4 className="mb-4 text-[11px] font-bold uppercase tracking-[1.5px] text-[#6b8299]">
                Product
              </h4>
              <div className="space-y-2.5">
                <a href="#how" className="block text-[13px] transition hover:text-white">How It Works</a>
                <a href="#package" className="block text-[13px] transition hover:text-white">What Buddy Builds</a>
                <Link href="/underwriter" className="block text-[13px] transition hover:text-white">For Lenders</Link>
              </div>
            </div>

            <div>
              <h4 className="mb-4 text-[11px] font-bold uppercase tracking-[1.5px] text-[#6b8299]">
                Company
              </h4>
              <div className="space-y-2.5">
                <a href="mailto:hello@buddysba.com" className="block text-[13px] transition hover:text-white">Contact Us</a>
              </div>
            </div>

            <div>
              <h4 className="mb-4 text-[11px] font-bold uppercase tracking-[1.5px] text-[#6b8299]">
                Resources
              </h4>
              <div className="space-y-2.5">
                <a href="#faq" className="block text-[13px] transition hover:text-white">FAQ</a>
                <a href="#financing" className="block text-[13px] transition hover:text-white">SBA Loan Types</a>
              </div>
            </div>

            <div>
              <h4 className="mb-4 text-[11px] font-bold uppercase tracking-[1.5px] text-[#6b8299]">
                Contact
              </h4>
              <a
                href="mailto:hello@buddysba.com"
                className="inline-flex items-center gap-2 text-[13px] transition hover:text-white"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                hello@buddysba.com
              </a>
            </div>
          </div>

          <div className="border-t border-white/[0.08] pt-6 text-center text-[12px] text-[#475569]">
            &copy; {new Date().getFullYear()} Buddy The Underwriter. All rights reserved.
          </div>
        </div>
      </footer>
    </main>
  );
}

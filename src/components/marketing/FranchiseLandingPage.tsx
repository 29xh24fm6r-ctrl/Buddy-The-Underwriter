"use client";

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

const SCORE_FACTORS = [
  {
    label: "SBA certification status",
    weight: "35%",
    desc: "Whether your brand carries an active SBA franchise certification and, if so, what addendum requirements apply.",
  },
  {
    label: "FDD Item 19 tier",
    weight: "30%",
    desc: "Where the brand's disclosed financial performance representations rank against comparable franchise systems.",
  },
  {
    label: "Brand maturity",
    weight: "20%",
    desc: "Unit count and system scale — an early-stage concept scores differently than an established, multi-hundred-unit brand.",
  },
  {
    label: "Franchisor support",
    weight: "15%",
    desc: "Signals drawn from Item 19 disclosure, SBA eligibility, and system size that indicate franchisor backing strength.",
  },
];

const LOOKUP_FIELDS = [
  "SBA eligibility & certification status",
  "Franchise fee range",
  "Total initial investment range",
  "Ongoing royalty percentage",
  "Net worth & liquidity requirements",
  "SBA addendum requirements",
];

export function FranchiseLandingPage() {
  return (
    <main
      className={`${poppins.variable} ${jakarta.variable} min-h-screen bg-[#f6f8fb] text-[#12263f] antialiased`}
      style={{ fontFamily: "var(--font-jakarta), sans-serif" }}
    >
      {/* NAV */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 sm:px-10 backdrop-blur-xl bg-[#f6f8fb]/85 border-b border-[#12263f]/[0.07]">
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
        <div className="flex items-center gap-4 sm:gap-[30px]">
          <Link
            href="/"
            className="hidden text-[15px] font-semibold text-[#3d5674] hover:text-[#1c8de0] sm:inline"
          >
            Home
          </Link>
          <Link
            href="/apply?path=franchise"
            className="rounded-xl bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] px-[22px] py-[11px] text-[15px] font-bold text-white shadow-[0_6px_18px_rgba(28,141,224,0.28)] transition hover:brightness-[1.06]"
          >
            Start your package
          </Link>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative overflow-hidden bg-[linear-gradient(160deg,#0e2340_0%,#12263f_55%,#173250_100%)] px-6 py-16 text-white sm:px-10 sm:py-[76px]">
        <div
          className="pointer-events-none absolute -right-20 -top-[120px] h-[460px] w-[460px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(28,141,224,0.28), transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-[840px] text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-[#4db8f0]/35 bg-[#1c8de0]/[0.16] px-[15px] py-[7px] text-[13px] font-semibold tracking-[0.3px] text-[#8fd0f7]">
            <span className="h-[7px] w-[7px] rounded-full bg-[#4db8f0]" />
            Franchise Financing
          </div>
          <h1
            className="mt-[22px] text-[32px] font-extrabold leading-[1.1] tracking-tight sm:text-[46px]"
            style={{ fontFamily: "var(--font-poppins), sans-serif" }}
          >
            SBA financing that already knows your franchise.
          </h1>
          <p className="mx-auto mb-9 mt-5 max-w-[600px] text-[17px] leading-relaxed text-[#b9cbdd] sm:text-[19px]">
            Buddy tracks SBA eligibility, certification status, and FDD Item
            19 financial performance data across thousands of franchise
            brands — and builds it directly into your SBA Score. Tell Buddy
            your brand, and the deal starts smarter.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3.5">
            <Link
              href="/apply?path=franchise"
              className="rounded-xl bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] px-[30px] py-[15px] text-[16px] font-bold text-white shadow-[0_10px_28px_rgba(28,141,224,0.4)] transition hover:brightness-[1.06]"
            >
              Start your franchise package
            </Link>
            <Link
              href="/start?path=franchise"
              className="rounded-xl border border-white/[0.18] bg-white/[0.08] px-[30px] py-[15px] text-[16px] font-bold text-white transition hover:bg-white/[0.14]"
            >
              Talk to Buddy
            </Link>
          </div>
          <div className="mt-[46px] flex flex-wrap items-center justify-center gap-x-[38px] gap-y-4">
            <div>
              <div
                className="text-[28px] font-bold text-[#4db8f0]"
                style={{ fontFamily: "var(--font-poppins), sans-serif" }}
              >
                8,400+
              </div>
              <div className="mt-0.5 text-[13px] text-[#8ba1b8]">
                Franchise brands tracked
              </div>
            </div>
            <div className="hidden h-10 w-px bg-white/[0.12] sm:block" />
            <div>
              <div
                className="text-[28px] font-bold text-[#4db8f0]"
                style={{ fontFamily: "var(--font-poppins), sans-serif" }}
              >
                1,476
              </div>
              <div className="mt-0.5 text-[13px] text-[#8ba1b8]">
                SBA-certified brands
              </div>
            </div>
            <div className="hidden h-10 w-px bg-white/[0.12] sm:block" />
            <div>
              <div
                className="text-[28px] font-bold text-[#4db8f0]"
                style={{ fontFamily: "var(--font-poppins), sans-serif" }}
              >
                853
              </div>
              <div className="mt-0.5 text-[13px] text-[#8ba1b8]">
                Brands with Item 19 data
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FRANCHISE QUALITY SCORE */}
      <section className="mx-auto max-w-[1100px] px-6 py-14 sm:px-10 sm:py-[90px]">
        <div className="mx-auto mb-12 max-w-[680px] text-center sm:mb-14">
          <div className="text-[13px] font-bold uppercase tracking-[1.5px] text-[#1c8de0]">
            Built into your SBA Score
          </div>
          <h2
            className="mb-3 mt-3.5 text-[26px] font-bold tracking-tight sm:text-[34px]"
            style={{ fontFamily: "var(--font-poppins), sans-serif" }}
          >
            Your Franchise Quality Score
          </h2>
          <p className="text-[16px] leading-relaxed text-[#5b7189]">
            Once you tell Buddy your brand, this component runs automatically
            as part of your overall SBA Score — no separate report, no extra
            step.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {SCORE_FACTORS.map((f) => (
            <div
              key={f.label}
              className="rounded-2xl border border-[#12263f]/[0.07] bg-white p-6 shadow-[0_2px_14px_rgba(18,38,63,0.04)]"
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[17px] font-semibold">{f.label}</h3>
                <span className="rounded-full bg-[#1c8de0]/[0.1] px-2.5 py-1 text-[12px] font-bold text-[#1c8de0]">
                  {f.weight}
                </span>
              </div>
              <p className="text-[14.5px] leading-relaxed text-[#5b7189]">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* BRAND LOOKUP */}
      <section className="mx-auto max-w-[1100px] px-6 pb-14 sm:px-10 sm:pb-[90px]">
        <div className="relative overflow-hidden rounded-[22px] bg-[linear-gradient(135deg,#0e2340,#173250)] px-7 py-10 text-white sm:px-14 sm:py-[52px]">
          <div
            className="pointer-events-none absolute -bottom-20 right-16 h-80 w-80 rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(28,141,224,0.25), transparent 70%)",
            }}
          />
          <div className="relative mx-auto max-w-[720px] text-center">
            <div className="text-[13px] font-bold uppercase tracking-[1.5px] text-[#8fd0f7]">
              Real-time brand lookup
            </div>
            <h2
              className="my-3 text-[24px] font-bold tracking-tight sm:text-[28px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Tell Buddy your brand. Buddy already knows the deal.
            </h2>
            <p className="mx-auto mb-8 max-w-[540px] text-[15.5px] leading-relaxed text-[#b9cbdd]">
              Buddy searches its franchise database in real time and pulls
              what matters for your application:
            </p>
            <div className="mx-auto grid max-w-[560px] grid-cols-1 gap-x-8 gap-y-3 text-left sm:grid-cols-2">
              {LOOKUP_FIELDS.map((field) => (
                <div key={field} className="flex items-center gap-2.5">
                  <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-[#4db8f0]" />
                  <span className="text-[14.5px] text-[#dce8f4]">{field}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="mx-auto max-w-[1240px] px-6 pb-16 pt-2 text-center sm:px-10 sm:pb-[100px]">
        <h2
          className="text-[30px] font-extrabold tracking-tight sm:text-[38px]"
          style={{ fontFamily: "var(--font-poppins), sans-serif" }}
        >
          Ready to finance your franchise?
        </h2>
        <p className="mx-auto my-4 max-w-[560px] text-[17px] leading-relaxed text-[#5b7189]">
          Start your SBA package and Buddy pulls your brand's SBA data in
          automatically — no separate franchise research required.
        </p>
        <Link
          href="/apply?path=franchise"
          className="inline-flex rounded-xl bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] px-10 py-[17px] text-[17px] font-bold text-white shadow-[0_12px_32px_rgba(28,141,224,0.35)] transition hover:brightness-[1.06]"
        >
          Start your franchise package
        </Link>
      </section>

      {/* FOOTER */}
      <footer className="bg-[#0e2340] px-6 py-[38px] text-[#8ba1b8] sm:px-10">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-[11px]">
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
          <div className="text-[13px]">
            Smarter Analysis. Stronger Approvals. &nbsp;·&nbsp; © 2026 Buddy
          </div>
        </div>
      </footer>
    </main>
  );
}

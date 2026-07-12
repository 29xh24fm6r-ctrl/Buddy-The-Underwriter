"use client";

import Link from "next/link";
import { Poppins, Plus_Jakarta_Sans } from "next/font/google";
import { buddyHeroImage } from "./heroImage";

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
    title: "Tell Buddy about your business",
    desc: "Answer questions about your business, financials, and loan needs. Buddy's AI concierge guides you.",
  },
  {
    n: 2,
    title: "Upload your documents",
    desc: "Tax returns, financials, and supporting docs. Buddy extracts and organizes everything.",
  },
  {
    n: 3,
    title: "Buddy builds your package",
    desc: "Business plan, projections, feasibility study, SBA forms — prepared and reviewed for completeness.",
  },
  {
    n: 4,
    title: "Lenders review and compete",
    desc: "Qualified SBA lenders see your anonymized profile and submit claims through the marketplace.",
  },
  {
    n: 5,
    title: "You choose your lender",
    desc: "Compare offers and pick the lender that fits. Your identity stays private until you decide.",
  },
  {
    n: 6,
    title: "Buddy coordinates closing",
    desc: "Conditions tracking, document collection, and funding verification — all the way to funded.",
  },
];

export function BrokerageLandingPage() {
  return (
    <main
      className={`${poppins.variable} ${jakarta.variable} min-h-screen bg-[#f6f8fb] text-[#12263f] antialiased`}
      style={{ fontFamily: "var(--font-jakarta), sans-serif" }}
    >
      {/* NAV */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 sm:px-10 backdrop-blur-xl bg-[#f6f8fb]/85 border-b border-[#12263f]/[0.07]">
        <div className="flex items-center gap-3">
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
        </div>
        <div className="flex items-center gap-4 sm:gap-[30px]">
          <a
            href="#how"
            className="hidden text-[15px] font-semibold text-[#3d5674] hover:text-[#1c8de0] sm:inline"
          >
            How it works
          </a>
          <a
            href="#fees"
            className="hidden text-[15px] font-semibold text-[#3d5674] hover:text-[#1c8de0] sm:inline"
          >
            Fees
          </a>
          <a
            href="#banks"
            className="hidden text-[15px] font-semibold text-[#3d5674] hover:text-[#1c8de0] sm:inline"
          >
            For lenders
          </a>
          <Link
            href="/franchise"
            className="hidden text-[15px] font-semibold text-[#3d5674] hover:text-[#1c8de0] sm:inline"
          >
            Franchise financing
          </Link>
          <Link
            href="/apply"
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
        <div className="relative mx-auto grid max-w-[1240px] items-center gap-10 sm:gap-14 lg:grid-cols-[1fr_1.05fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#4db8f0]/35 bg-[#1c8de0]/[0.16] px-[15px] py-[7px] text-[13px] font-semibold tracking-[0.3px] text-[#8fd0f7]">
              <span className="h-[7px] w-[7px] rounded-full bg-[#4db8f0]" />
              The world&apos;s first Loan Operations System
            </div>
            <h1
              className="mt-[22px] text-[34px] font-extrabold leading-[1.08] tracking-tight sm:text-[52px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Your SBA loan package, built and matched to the right lender.
            </h1>
            <p className="mb-[34px] mt-5 max-w-[520px] text-[17px] leading-relaxed text-[#b9cbdd] sm:text-[19px]">
              Buddy prepares your complete SBA application, scores your deal,
              and connects you with qualified lenders through a competitive
              marketplace. You pick the lender — we coordinate closing.
            </p>
            <div className="flex flex-wrap gap-3.5">
              <Link
                href="/apply"
                className="rounded-xl bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] px-[30px] py-[15px] text-[16px] font-bold text-white shadow-[0_10px_28px_rgba(28,141,224,0.4)] transition hover:brightness-[1.06]"
              >
                Start your SBA package
              </Link>
              <Link
                href="/start"
                className="rounded-xl border border-white/[0.18] bg-white/[0.08] px-[30px] py-[15px] text-[16px] font-bold text-white transition hover:bg-white/[0.14]"
              >
                Talk to Buddy
              </Link>
            </div>
            <div className="mt-[42px] flex flex-wrap gap-x-[30px] gap-y-4">
              <div>
                <div
                  className="text-[26px] font-bold text-[#4db8f0]"
                  style={{ fontFamily: "var(--font-poppins), sans-serif" }}
                >
                  92%
                </div>
                <div className="mt-0.5 text-[13px] text-[#8ba1b8]">
                  Avg. confidence score
                </div>
              </div>
              <div className="hidden w-px bg-white/[0.12] sm:block" />
              <div>
                <div
                  className="text-[26px] font-bold text-[#4db8f0]"
                  style={{ fontFamily: "var(--font-poppins), sans-serif" }}
                >
                  End-to-end
                </div>
                <div className="mt-0.5 text-[13px] text-[#8ba1b8]">
                  Intake to funded
                </div>
              </div>
              <div className="hidden w-px bg-white/[0.12] sm:block" />
              <div>
                <div
                  className="text-[26px] font-bold text-[#4db8f0]"
                  style={{ fontFamily: "var(--font-poppins), sans-serif" }}
                >
                  SBA 7(a)
                </div>
                <div className="mt-0.5 text-[13px] text-[#8ba1b8]">
                  &amp; 504 ready
                </div>
              </div>
            </div>
          </div>
          <div className="relative">
            <div
              className="absolute -inset-3.5 rounded-3xl"
              style={{
                background:
                  "linear-gradient(135deg, rgba(28,141,224,0.35), transparent)",
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={buddyHeroImage}
              alt="Buddy the SBA Underwriter with loan underwriting dashboard"
              className="relative block w-full rounded-2xl shadow-[0_30px_70px_rgba(0,0,0,0.5)]"
            />
          </div>
        </div>
      </section>

      {/* FRANCHISE ENTRANCE */}
      <section className="mx-auto max-w-[1240px] px-6 pt-14 sm:px-10 sm:pt-[70px]">
        <Link
          href="/franchise"
          className="group relative flex flex-wrap items-center justify-between gap-8 overflow-hidden rounded-[22px] border border-[#1c8de0]/[0.15] bg-gradient-to-br from-white to-[#eef6fd] px-7 py-8 shadow-[0_2px_14px_rgba(18,38,63,0.05)] transition hover:shadow-[0_16px_36px_rgba(28,141,224,0.14)] sm:px-12 sm:py-10"
        >
          <div
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-70"
            style={{
              background:
                "radial-gradient(circle, rgba(28,141,224,0.14), transparent 70%)",
            }}
          />
          <div className="relative max-w-[620px]">
            <div className="inline-flex items-center gap-2 rounded-full bg-[#1c8de0]/[0.1] px-[13px] py-[6px] text-[12.5px] font-bold uppercase tracking-[0.5px] text-[#1c8de0]">
              Buying a franchise?
            </div>
            <h2
              className="mb-2 mt-3 text-[24px] font-bold tracking-tight text-[#12263f] sm:text-[28px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Buddy tracks SBA data on 8,400+ franchise brands
            </h2>
            <p className="text-[15.5px] leading-relaxed text-[#5b7189]">
              SBA certification status, FDD Item 19 performance data, and
              franchisor support signals — built directly into your SBA
              Score. Tell Buddy your brand and it already knows the deal.
            </p>
          </div>
          <span className="relative inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-[#12263f] px-6 py-[13px] text-[15px] font-bold text-white transition group-hover:brightness-110">
            Explore franchise financing →
          </span>
        </Link>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="mx-auto max-w-[1240px] px-6 py-14 sm:px-10 sm:py-[90px]">
        <div className="mx-auto mb-14 max-w-[640px] text-center sm:mb-[56px]">
          <div className="text-[13px] font-bold uppercase tracking-[1.5px] text-[#1c8de0]">
            How it works
          </div>
          <h2
            className="mb-3 mt-3.5 text-[28px] font-bold tracking-tight sm:text-[38px]"
            style={{ fontFamily: "var(--font-poppins), sans-serif" }}
          >
            From application to funded, guided the whole way
          </h2>
          <p className="text-[17px] leading-relaxed text-[#5b7189]">
            Buddy&apos;s AI concierge walks you through every step. Your
            identity stays private until you choose a lender.
          </p>
        </div>
        <div className="grid gap-[22px] sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="rounded-2xl border border-[#12263f]/[0.07] bg-white p-7 shadow-[0_2px_14px_rgba(18,38,63,0.04)] transition hover:-translate-y-1 hover:shadow-[0_12px_30px_rgba(18,38,63,0.1)]"
            >
              <div
                className="mb-[18px] flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#0e2340] to-[#1c8de0] text-[19px] font-bold text-white"
                style={{ fontFamily: "var(--font-poppins), sans-serif" }}
              >
                {s.n}
              </div>
              <h3 className="mb-2 text-[19px] font-semibold">{s.title}</h3>
              <p className="text-[15px] leading-relaxed text-[#5b7189]">
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* FOR BANKS */}
      <section id="banks" className="mx-auto max-w-[1240px] px-6 pb-14 sm:px-10 sm:pb-[90px]">
        <div className="relative flex flex-wrap items-center justify-between gap-10 overflow-hidden rounded-[22px] bg-[linear-gradient(135deg,#0e2340,#173250)] px-7 py-9 text-white sm:px-14 sm:py-[52px]">
          <div
            className="pointer-events-none absolute -bottom-20 right-16 h-80 w-80 rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(28,141,224,0.25), transparent 70%)",
            }}
          />
          <div className="relative max-w-[560px]">
            <div className="text-[13px] font-bold uppercase tracking-[1.5px] text-[#8fd0f7]">
              For banks &amp; SBA lenders
            </div>
            <h2
              className="my-3 text-[26px] font-bold tracking-tight sm:text-[30px]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Looking for Buddy The Underwriter?
            </h2>
            <p className="text-[16px] leading-relaxed text-[#b9cbdd]">
              Our bank-facing underwriting intelligence platform — guided
              intake, underwriting automation, and examiner-safe audit
              trails.
            </p>
          </div>
          <Link
            href="/underwriter"
            className="relative whitespace-nowrap rounded-xl bg-white px-7 py-[15px] text-[16px] font-bold text-[#12263f] transition hover:brightness-95"
          >
            Explore the banking platform →
          </Link>
        </div>
      </section>

      {/* FINAL CTA */}
      <section id="start" className="mx-auto max-w-[1240px] px-6 pb-16 pt-6 text-center sm:px-10 sm:pb-[100px]">
        <h2
          className="text-[32px] font-extrabold tracking-tight sm:text-[42px]"
          style={{ fontFamily: "var(--font-poppins), sans-serif" }}
        >
          Ready to get started?
        </h2>
        <p className="mx-auto my-4 max-w-[560px] text-[18px] leading-relaxed text-[#5b7189]">
          Buddy builds your complete SBA package and matches you with the
          right lender. Start in minutes.
        </p>
        <Link
          href="/apply"
          className="inline-flex rounded-xl bg-gradient-to-br from-[#1c8de0] to-[#4db8f0] px-10 py-[17px] text-[17px] font-bold text-white shadow-[0_12px_32px_rgba(28,141,224,0.35)] transition hover:brightness-[1.06]"
        >
          Start your SBA package
        </Link>
      </section>

      {/* FEE DISCLOSURE */}
      <section id="fees" className="mx-auto max-w-[900px] px-6 pb-14 sm:px-10 sm:pb-[70px]">
        <div className="border-t border-[#12263f]/[0.09] pt-[22px]">
          <div className="mb-2 flex items-center gap-2.5">
            <span
              className="text-[13px] font-bold uppercase tracking-[0.5px] text-[#3d5674]"
              style={{ fontFamily: "var(--font-poppins), sans-serif" }}
            >
              Fee disclosure
            </span>
            <span className="text-[12px] font-bold text-[#16a34a]">
              $1,000 packaging fee
            </span>
          </div>
          <p className="text-[12.5px] leading-relaxed text-[#6b8299]">
            A packaging fee of $1,000 applies for SBA loan preparation and
            lender matching services. This fee may be financed into the loan
            at closing, subject to lender approval. Buddy may also receive a
            referral fee from the selected lender, disclosed on SBA Form 159.
            Buddy does not guarantee loan approval — SBA loan approval is
            subject to lender underwriting, SBA guidelines, and borrower
            eligibility.
          </p>
        </div>
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

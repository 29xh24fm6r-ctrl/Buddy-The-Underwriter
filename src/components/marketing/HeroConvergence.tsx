"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.08 * i, duration: 0.55 } }),
};

type Tick = {
  label: string;
  sub: string;
  pill: string;
};

function useReadinessTicker() {
  const ticks: Tick[] = useMemo(
    () => [
      { label: "Uploads processing", sub: "1 remaining", pill: "⏳" },
      { label: "Checklist incomplete", sub: "2 items missing", pill: "⏳" },
      { label: "Deal Ready", sub: "All requirements satisfied", pill: "✅" },
    ],
    []
  );

  const [i, setI] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let raf = 0;
    let start = performance.now();
    const cycleMs = 2600;

    const loop = (t: number) => {
      const elapsed = t - start;
      const p = Math.min(1, elapsed / cycleMs);
      setProgress(p);
      if (p >= 1) {
        setI((v) => (v + 1) % ticks.length);
        start = t;
        setProgress(0);
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ticks.length]);

  return { tick: ticks[i], progress };
}

export function HeroConvergence() {
  const { tick, progress } = useReadinessTicker();

  return (
    <section className="relative overflow-hidden">
      {/* Background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900" />
        <div className="absolute inset-0 opacity-35 [background-image:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.08)_1px,transparent_0)] [background-size:28px_28px]" />
        <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute top-32 -right-24 h-[28rem] w-[28rem] rounded-full bg-white/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl px-6 pb-18 pt-16 md:pb-24 md:pt-24">
        <div className="grid items-center gap-10 md:grid-cols-2">
          {/* Left: Copy */}
          <div>
            <motion.div variants={fadeUp} initial="hidden" animate="show" custom={0}>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-white/60" />
                Loan Operations System • Converges deals to readiness
              </div>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              initial="hidden"
              animate="show"
              custom={1}
              className="mt-5 text-4xl font-semibold tracking-tight text-white md:text-6xl"
            >
              Commercial lending
              <br />
              without the chaos.
            </motion.h1>

            <motion.p
              variants={fadeUp}
              initial="hidden"
              animate="show"
              custom={2}
              className="mt-5 max-w-xl text-base leading-relaxed text-white/70 md:text-lg"
            >
              Buddy is a <span className="text-white">Loan Operations System</span>. Upload documents and the system{" "}
              <span className="text-white">converges the deal to readiness</span> — automatically.
            </motion.p>

            <motion.ul
              variants={fadeUp}
              initial="hidden"
              animate="show"
              custom={3}
              className="mt-6 space-y-2 text-sm text-white/75"
            >
              <li className="flex items-center gap-2">
                <span className="text-white/80">•</span> No workflows to run
              </li>
              <li className="flex items-center gap-2">
                <span className="text-white/80">•</span> No steps to memorize
              </li>
              <li className="flex items-center gap-2">
                <span className="text-white/80">•</span> No training required
              </li>
            </motion.ul>

            <motion.div variants={fadeUp} initial="hidden" animate="show" custom={4} className="mt-8 flex flex-wrap gap-3">
              <a
                href="#see-it-converge"
                className="rounded-2xl bg-white px-5 py-3 text-sm font-medium text-slate-900 shadow-[0_20px_60px_rgba(255,255,255,0.12)]"
              >
                See it converge
              </a>
              <a
                href="#request-access"
                className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-medium text-white backdrop-blur hover:bg-white/10"
              >
                Request access
              </a>
            </motion.div>
          </div>

          {/* Right: Live readiness card */}
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={2}
            className="relative"
          >
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-white">Deal Status</div>
                <div className="text-xs text-white/60">Live</div>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-white">
                      <span>{tick.pill}</span>
                      <span>{tick.label}</span>
                    </div>
                    <div className="mt-1 text-xs text-white/60">{tick.sub}</div>
                  </div>

                  <div className="text-[10px] text-white/50">updated just now</div>
                </div>

                {/* WOW++++++++ ticker progress */}
                <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <motion.div
                    className="h-full bg-white/70"
                    style={{ width: `${Math.max(6, Math.floor(progress * 100))}%` }}
                    transition={{ duration: 0.1 }}
                  />
                </div>

                <div className="mt-4 grid gap-2">
                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <div className="text-xs text-white/70">Uploads</div>
                    <div className="text-xs text-white/60">finalized • ledger-backed</div>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <div className="text-xs text-white/70">Checklist</div>
                    <div className="text-xs text-white/60">read-only truth</div>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <div className="text-xs text-white/70">Readiness</div>
                    <div className="text-xs text-white/60">single source of truth</div>
                  </div>
                </div>
              </div>

              <div className="mt-4 text-xs text-white/60">
                The system converges to readiness. The UI simply shows the truth.
              </div>
            </div>

            <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2.5rem] bg-white/10 blur-3xl" />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

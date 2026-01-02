"use client";

import { motion } from "framer-motion";

const steps = [
  { title: "Upload received", desc: "Files land. No babysitting." },
  { title: "Evidence finalized", desc: "Uploads become verified evidence." },
  { title: "Checklist reconciled", desc: "The system updates itself." },
  { title: "Deal ready", desc: "Buddy tells you the moment it's ready." },
];

export function ConvergenceTimeline() {
  return (
    <section id="see-it-converge" className="bg-slate-950">
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <div className="flex items-end justify-between gap-6">
          <div>
            <div className="text-sm font-medium text-white/70">From workflows → convergence</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">
              Deals don't need running. They need converging.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/65 md:text-base">
              Upload documents from banker, borrower, or link. Buddy finalizes evidence, reconciles requirements, and
              updates readiness automatically.
            </p>
          </div>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-4">
          {steps.map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ delay: 0.06 * i, duration: 0.5 }}
              className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur"
            >
              <div className="flex items-center justify-between">
                <div className="text-xs text-white/55">Step {i + 1}</div>
                <div className="h-2 w-2 rounded-full bg-white/40" />
              </div>
              <div className="mt-3 text-base font-medium text-white">{s.title}</div>
              <div className="mt-2 text-sm text-white/65">{s.desc}</div>
              <div className="mt-5 h-px w-full bg-white/10" />
              <div className="mt-4 text-xs text-white/50">Ledger-backed, race-proof, explainable.</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

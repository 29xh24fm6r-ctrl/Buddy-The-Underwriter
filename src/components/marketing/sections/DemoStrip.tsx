"use client";

import { Container, Section } from "@/components/marketing/MarketingShell";
import { Badge } from "@/components/ui/Badge";
import { motion } from "framer-motion";

type StepRow = {
  k: string;
  v: string;
  hint?: string;
};

type StepRight = {
  label: string;
  rows: StepRow[];
};

type Step = {
  k: string;
  title: string;
  subtitle: string;
  chips: string[];
  right: StepRight;
};

const steps: Step[] = [
  {
    k: "upload",
    title: "Upload → Evidence",
    subtitle: "Files stop being \"attachments\" and become typed evidence objects.",
    chips: ["Borrower or Banker", "Canonical types", "No loose shapes"],
    right: {
      label: "Evidence created",
      rows: [
        { k: "Document", v: "2023 Tax Return (1120S)", hint: "normalized + typed" },
        { k: "Owner", v: "PFS — Matt P", hint: "linked to borrower entity" },
        { k: "Status", v: "Received", hint: "checklist auto-updated" },
      ],
    },
  },
  {
    k: "extract",
    title: "Extract → Highlight",
    subtitle: "Buddy maps values to source snippets you can actually trust.",
    chips: ["Evidence-linked fields", "Confidence + provenance", "No re-keying"],
    right: {
      label: "Field extraction",
      rows: [
        { k: "DSCR", v: "1.31×", hint: "from cash flow evidence" },
        { k: "Revenue", v: "$3,482,190", hint: "from return line item" },
        { k: "Liquidity", v: "$412,550", hint: "from statement" },
      ],
    },
  },
  {
    k: "confirm",
    title: "Confirm → Truth",
    subtitle: "Humans approve. Machines remember forever.",
    chips: ["Human-in-the-loop", "Field-level confirmation", "Audit-ready"],
    right: {
      label: "Confirmation log",
      rows: [
        { k: "Confirmed by", v: "Borrower", hint: "portal confirmation" },
        { k: "Timestamp", v: "Recorded", hint: "immutable event" },
        { k: "Result", v: "Verified Truth", hint: "ready for underwriting" },
      ],
    },
  },
  {
    k: "underwrite",
    title: "Run → Underwriting",
    subtitle: "Policies execute. Exceptions surface. Decisions are captured with evidence.",
    chips: ["Policy-aware", "Ratios + exceptions", "Repeatable execution"],
    right: {
      label: "Underwriting run",
      rows: [
        { k: "Policy", v: "SBA 7(a) + Bank overlays", hint: "versioned rules" },
        { k: "Exceptions", v: "1 flagged", hint: "auto-routed" },
        { k: "Outcome", v: "Conditional Approve", hint: "with conditions" },
      ],
    },
  },
  {
    k: "audit",
    title: "Decide → Audit Trail",
    subtitle: "If it isn't auditable, it doesn't exist.",
    chips: ["Decision lineage", "Evidence provenance", "Controlled access"],
    right: {
      label: "Audit trail",
      rows: [
        { k: "Who did what", v: "Captured", hint: "actors + events" },
        { k: "Why", v: "Evidence-linked", hint: "no mystery decisions" },
        { k: "Export", v: "Audit-ready packet", hint: "compliance friendly" },
      ],
    },
  },
];

function Dot() {
  return (
    <div className="relative">
      <div className="h-2.5 w-2.5 rounded-full bg-black" />
      <div className="absolute -inset-2 rounded-full bg-black/10 blur-[2px]" />
    </div>
  );
}

export function DemoStrip() {
  return (
    <Section className="py-10 sm:py-14">
      <Container>
        <div className="rounded-[32px] border border-black/10 bg-white shadow-[0_18px_70px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-6 py-6 sm:px-10 sm:py-8 border-b border-black/10 bg-gradient-to-b from-black/[0.03] to-transparent">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-black/60">A loan, end-to-end</div>
                <div className="mt-1 text-xl font-semibold tracking-tight">
                  Watch Buddy turn chaos into execution.
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge>Evidence-first</Badge>
                <Badge>Human-confirmed truth</Badge>
                <Badge>Audit by default</Badge>
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-12">
            {/* LEFT: timeline */}
            <div className="lg:col-span-7 border-b lg:border-b-0 lg:border-r border-black/10">
              <div className="p-6 sm:p-10">
                <div className="flex items-center gap-3 text-xs font-medium text-black/60">
                  <span>DEMO STRIP</span>
                  <span className="h-1 w-1 rounded-full bg-black/20" />
                  <span>Not a mock — a model of how Buddy operates</span>
                </div>

                <div className="mt-8 grid gap-6">
                  {steps.map((s, i) => (
                    <motion.div
                      key={s.k}
                      initial={{ opacity: 0, y: 10 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, amount: 0.3 }}
                      transition={{ duration: 0.35, delay: i * 0.05 }}
                      className="relative"
                    >
                      {/* connector line */}
                      {i !== steps.length - 1 && (
                        <div className="absolute left-[5px] top-3 h-[calc(100%+18px)] w-px bg-black/10" />
                      )}

                      <div className="flex gap-4">
                        <div className="pt-1">
                          <Dot />
                        </div>

                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="text-base font-semibold">{s.title}</div>
                            <div className="text-xs text-black/50">
                              Step {String(i + 1).padStart(2, "0")}
                            </div>
                          </div>

                          <div className="mt-2 text-sm text-black/70 leading-relaxed">
                            {s.subtitle}
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            {s.chips.map((c) => (
                              <span
                                key={c}
                                className="rounded-full border border-black/10 bg-black/[0.02] px-3 py-1 text-xs text-black/70"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>

                <div className="mt-10 rounded-[24px] border border-black/10 bg-black/[0.02] p-5">
                  <div className="text-xs font-medium text-black/60">The rule</div>
                  <div className="mt-2 text-sm leading-relaxed">
                    Buddy treats every loan like an operating process:
                    evidence → verified truth → policy execution → auditable decision.
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT: "live" side panel */}
            <div className="lg:col-span-5">
              <div className="p-6 sm:p-10">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Deal Console</div>
                  <div className="text-xs text-black/50">live-style preview</div>
                </div>

                <div className="mt-4 rounded-[24px] border border-black/10 bg-white">
                  <div className="border-b border-black/10 p-4">
                    <div className="text-xs font-medium text-black/60">Deal</div>
                    <div className="mt-1 text-sm font-semibold">ACME Manufacturing — Expansion</div>
                    <div className="mt-1 text-xs text-black/50">
                      Intake • Docs • Verification • Underwriting • Compliance
                    </div>
                  </div>

                  <div className="p-4 grid gap-3">
                    {steps.map((s) => (
                      <div key={s.k} className="rounded-2xl border border-black/10 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold">{s.right.label}</div>
                          <span className="text-[11px] rounded-full border border-black/10 px-2 py-1 text-black/60">
                            system event
                          </span>
                        </div>

                        <div className="mt-3 grid gap-2">
                          {s.right.rows.map((r) => (
                            <div
                              key={r.k}
                              className="flex items-start justify-between gap-4 text-xs"
                            >
                              <div className="text-black/50">{r.k}</div>
                              <div className="text-right">
                                <div className="text-black/80 font-medium">{r.v}</div>
                                {r.hint ? (
                                  <div className="text-black/40">{r.hint}</div>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 text-xs text-black/50">
                  This is the emotional point: it feels like lending has a "control plane."
                </div>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}

"use client";

import { motion } from "framer-motion";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  BorrowerJourneyMilestone,
  MilestoneStatus,
} from "@/lib/borrower/buildBorrowerJourneyViewModel";

const STATUS_STYLES: Record<
  MilestoneStatus,
  {
    dot: string;
    label: string;
    connector: string;
    iconName?: "check_circle" | "error";
  }
> = {
  completed: {
    dot: "border-emerald-300 bg-emerald-50 text-emerald-700",
    label: "text-emerald-800 font-semibold",
    connector: "bg-emerald-300",
    iconName: "check_circle",
  },
  current: {
    dot: "border-amber-300 bg-amber-50 text-amber-800 ring-4 ring-amber-100",
    label: "text-slate-900 font-semibold",
    connector: "bg-slate-200",
  },
  blocked: {
    dot: "border-rose-300 bg-rose-50 text-rose-700 ring-4 ring-rose-100",
    label: "text-rose-800 font-semibold",
    connector: "bg-slate-200",
    iconName: "error",
  },
  upcoming: {
    dot: "border-slate-200 bg-slate-50 text-slate-400",
    label: "text-slate-500",
    connector: "bg-slate-200",
  },
};

function MilestoneDot({
  status,
  index,
}: {
  status: MilestoneStatus;
  index: number;
}) {
  const styles = STATUS_STYLES[status];
  const isCompleted = status === "completed";
  return (
    <motion.div
      initial={isCompleted ? { scale: 0.5, opacity: 0 } : false}
      animate={isCompleted ? { scale: 1, opacity: 1 } : undefined}
      transition={{ type: "spring", stiffness: 400, damping: 22 }}
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-all",
        styles.dot,
      )}
    >
      {styles.iconName ? (
        <Icon name={styles.iconName} className="h-5 w-5 text-current" />
      ) : (
        <span>{index + 1}</span>
      )}
    </motion.div>
  );
}

function StatusTag({ status }: { status: MilestoneStatus }) {
  if (status === "completed") {
    return (
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-700">
        Completed
      </span>
    );
  }
  if (status === "current") {
    return (
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-amber-700">
        In progress
      </span>
    );
  }
  if (status === "blocked") {
    return (
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-rose-700">
        Needs attention
      </span>
    );
  }
  return null;
}

export function BorrowerJourneyMilestones({
  milestones,
}: {
  milestones: BorrowerJourneyMilestone[];
}) {
  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
        Your funding journey
      </div>
      <h2 className="mt-2 font-heading text-lg font-bold text-slate-900 sm:text-xl">
        Milestones toward lender submission
      </h2>

      {/* Desktop: horizontal */}
      <div className="mt-6 hidden lg:block">
        <div className="flex items-start">
          {milestones.map((m, i) => {
            const styles = STATUS_STYLES[m.status];
            const isLast = i === milestones.length - 1;
            return (
              <div
                key={m.id}
                className={cn("flex flex-col items-center text-center", {
                  "flex-1": !isLast,
                  "flex-shrink-0": isLast,
                })}
              >
                <div className="flex w-full items-center">
                  {i > 0 && (
                    <div
                      className={cn(
                        "h-0.5 flex-1",
                        STATUS_STYLES[milestones[i - 1].status].connector,
                      )}
                    />
                  )}
                  <MilestoneDot status={m.status} index={i} />
                  {!isLast && (
                    <div className={cn("h-0.5 flex-1", styles.connector)} />
                  )}
                </div>
                <div className="mt-3 max-w-[120px]">
                  <div
                    className={cn("text-xs leading-tight", styles.label)}
                  >
                    {m.label}
                  </div>
                  <StatusTag status={m.status} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: vertical */}
      <ol className="mt-5 space-y-3 lg:hidden">
        {milestones.map((m, i) => {
          const styles = STATUS_STYLES[m.status];
          const isLast = i === milestones.length - 1;
          return (
            <li key={m.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <MilestoneDot status={m.status} index={i} />
                {!isLast && (
                  <div
                    className={cn("mt-1 h-full min-h-4 w-0.5", styles.connector)}
                  />
                )}
              </div>
              <div className="pb-1">
                <div className={cn("text-sm leading-tight", styles.label)}>
                  {m.label}
                </div>
                <div className="mt-0.5 text-xs leading-5 text-slate-500">
                  {m.description}
                </div>
                <StatusTag status={m.status} />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

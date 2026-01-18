import type { BuddySignalBase, BuddySignalType } from "@/buddy/signals";

export type BuddyRole = "borrower" | "banker" | "builder";

export type BuddySignal = Omit<BuddySignalBase, "ts"> & { ts?: number } & {
  // Legacy/compat fields
  role?: BuddyRole;
  route?: string;
  page?: string;
  action?: string; // e.g. "navigated", "clicked", "saved", "uploaded"
  severity?: "info" | "warn" | "risk";
  hesitationScore?: number; // 0..1
  message?: string; // human note (what user saw / felt)
  meta?: Record<string, unknown>;
};

export type { BuddySignalType };

export type BuddyObserverInsight = {
  ts: number;
  severity: "info" | "warn" | "risk";
  title: string;
  detail?: string;
  suggestedNext?: string;
  route?: string;
  page?: string;
  dealId?: string | null;
  meta?: Record<string, unknown>;
};

// src/buddy/signals.ts
// Canonical Buddy signal contract (single source of truth).

export type BuddySignalType =
  | "page.ready"
  | "deal.loaded"
  | "deal.ignited"
  | "checklist.updated"
  | "pipeline.event"
  | "user.action"
  | "user.mark"
  | "ui.toast"
  | "error";

export interface BuddySignalBase {
  type: BuddySignalType;
  ts: number;
  source: string; // file/module/system emitting this signal
  dealId?: string | null;
  payload?: Record<string, any>;
}

// src/buddy/findings.ts

export type FindingKind = "bug" | "confusing" | "magical";

export type FindingSeverity = "blocker" | "major" | "minor" | "n/a";

export interface BuddyFinding {
  id: string;
  createdAt: number;
  runId: string | null;
  kind: FindingKind;
  severity: FindingSeverity;
  note?: string;
  path?: string;
  sourceSignalTs: number;
  contextSignals: any[];
}

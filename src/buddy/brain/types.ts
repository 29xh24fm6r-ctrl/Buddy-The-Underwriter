import type { BuddyRole } from "@/buddy/types";

export type BuddyIntent = "reassure" | "next_steps" | "explain" | "warn" | "debug";

export interface BuddyContextPack {
  role: BuddyRole;
  path: string;
  dealId?: string | null;
  checklist?: {
    received?: number;
    missing?: number;
    missingKeys?: string[];
  };
  deal?: {
    stage?: string;
    entity_type?: string;
    risk_score?: number | null;
    borrower_name?: string | null;
  };
  recentSignals: any[];
}

export interface BuddyReply {
  intent: BuddyIntent;
  message: string;
  actions?: Array<{ id: string; label: string; payload?: Record<string, any> }>;
}

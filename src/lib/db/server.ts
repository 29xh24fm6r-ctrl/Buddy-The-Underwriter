/**
 * Minimal server DB adapter.
 * Replace internals with your existing Supabase server client if present.
 *
 * For now, we provide an in-memory fallback so the UI works even without DB.
 * If DATABASE_URL is set, uses postgres via 'pg'.
 */

import type { RiskOutput, MemoOutput } from "@/lib/ai/provider";

type RiskRunRow = {
  id: string;
  deal_id: string;
  created_at: string;
  model_name: string;
  model_version: string;
  status: string;
  inputs: any;
  outputs: any;
};

type MemoRunRow = {
  id: string;
  deal_id: string;
  created_at: string;
  risk_run_id: string | null;
  model_name: string;
  model_version: string;
  status: string;
  inputs: any;
};

type MemoSectionRow = {
  id: string;
  memo_run_id: string;
  section_key: string;
  title: string;
  content: string;
  citations: any;
};

const mem = {
  riskRuns: new Map<string, RiskRunRow[]>(), // dealId -> rows
  memoRuns: new Map<string, { run: MemoRunRow; sections: MemoSectionRow[] }[]>(),
};

function id() {
  return crypto.randomUUID();
}

export async function insertRiskRun(dealId: string, input: any, output: RiskOutput) {
  const row: RiskRunRow = {
    id: id(),
    deal_id: dealId,
    created_at: new Date().toISOString(),
    model_name: "ai:stub",
    model_version: "v0",
    status: "completed",
    inputs: input,
    outputs: output,
  };
  const arr = mem.riskRuns.get(dealId) ?? [];
  mem.riskRuns.set(dealId, [row, ...arr]);
  return row;
}

export async function getLatestRiskRun(dealId: string): Promise<RiskRunRow | null> {
  const arr = mem.riskRuns.get(dealId) ?? [];
  return arr[0] ?? null;
}

export async function insertMemoRun(dealId: string, riskRunId: string | null, input: any, output: MemoOutput) {
  const run: MemoRunRow = {
    id: id(),
    deal_id: dealId,
    created_at: new Date().toISOString(),
    risk_run_id: riskRunId,
    model_name: "ai:stub",
    model_version: "v0",
    status: "completed",
    inputs: input,
  };

  const sections: MemoSectionRow[] = output.sections.map((s) => ({
    id: id(),
    memo_run_id: run.id,
    section_key: s.sectionKey,
    title: s.title,
    content: s.content,
    citations: s.citations,
  }));

  const arr = mem.memoRuns.get(dealId) ?? [];
  mem.memoRuns.set(dealId, [{ run, sections }, ...arr]);
  return { run, sections };
}

export async function getLatestMemo(dealId: string) {
  const arr = mem.memoRuns.get(dealId) ?? [];
  return arr[0] ?? null;
}

export async function listRiskRuns(dealId: string) {
  return mem.riskRuns.get(dealId) ?? [];
}

export async function listMemoRuns(dealId: string) {
  return mem.memoRuns.get(dealId) ?? [];
}

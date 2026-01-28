"use client";

import { useEffect, useCallback } from "react";
import useSWR from "swr";
import { onChecklistRefresh } from "@/lib/events/uiEvents";

export type ChecklistDetailItem = {
  id: string;
  checklist_key: string;
  title: string;
  description: string | null;
  required: boolean;
  status: string;
  required_years: number[] | null;
  satisfied_years: number[] | null;
};

export type ChecklistGrouped = {
  satisfied: ChecklistDetailItem[];
  pending: ChecklistDetailItem[];
  optional: ChecklistDetailItem[];
  counts: { total: number; received: number; pending: number; optional: number };
};

const PROTECTED_REQUIRED_KEYS = new Set(["IRS_BUSINESS_3Y", "IRS_PERSONAL_3Y"]);

export function isProtectedKey(key: string): boolean {
  return PROTECTED_REQUIRED_KEYS.has(key);
}

function normStatus(s: unknown): string {
  return String(s || "").toLowerCase().trim();
}

function isSatisfied(status: string): boolean {
  const s = normStatus(status);
  return s === "received" || s === "satisfied" || s === "waived";
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch checklist");
  const json = await res.json();
  if (!json.ok) throw new Error(json.error?.message || "Checklist error");
  return json;
};

export function useChecklistDetail(dealId: string): {
  items: ChecklistDetailItem[];
  grouped: ChecklistGrouped;
  isLoading: boolean;
  error: string | null;
  mutate: () => void;
} {
  const { data, error, isLoading, mutate } = useSWR(
    dealId ? `/api/deals/${dealId}/checklist/list` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 },
  );

  // Listen for refresh events
  useEffect(() => {
    if (!dealId) return;
    return onChecklistRefresh(dealId, () => {
      mutate();
    });
  }, [dealId, mutate]);

  const items: ChecklistDetailItem[] = (data?.items || []).map((item: any) => ({
    id: item.id,
    checklist_key: item.checklist_key,
    title: item.title || item.checklist_key,
    description: item.description || null,
    required: item.required ?? true,
    status: normStatus(item.status),
    required_years: item.required_years ? (Array.isArray(item.required_years) ? item.required_years : [item.required_years]) : null,
    satisfied_years: item.satisfied_years ? (Array.isArray(item.satisfied_years) ? item.satisfied_years : [item.satisfied_years]) : null,
  }));

  const grouped: ChecklistGrouped = {
    satisfied: items.filter((i) => i.required && isSatisfied(i.status)),
    pending: items.filter((i) => i.required && !isSatisfied(i.status)),
    optional: items.filter((i) => !i.required),
    counts: {
      total: items.filter((i) => i.required).length,
      received: items.filter((i) => i.required && isSatisfied(i.status)).length,
      pending: items.filter((i) => i.required && !isSatisfied(i.status)).length,
      optional: items.filter((i) => !i.required).length,
    },
  };

  return {
    items,
    grouped,
    isLoading,
    error: error?.message || null,
    mutate: useCallback(() => { mutate(); }, [mutate]),
  };
}

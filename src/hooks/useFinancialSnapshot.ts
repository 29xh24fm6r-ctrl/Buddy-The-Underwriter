"use client";

import useSWR from "swr";
import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";

export type FinancialSnapshotApiOk = {
  ok: true;
  dealId: string;
  bankId: string;
  snapshot: DealFinancialSnapshotV1;
};

export type FinancialSnapshotApiErr = {
  ok: false;
  error: string;
};

type FinancialSnapshotApiResponse = FinancialSnapshotApiOk | FinancialSnapshotApiErr;

const fetcher = async (url: string): Promise<FinancialSnapshotApiResponse> => {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return { ok: false, error: "not_found" };
  const json = (await res.json().catch(() => null)) as any;
  if (!json || typeof json !== "object") return { ok: false, error: `bad_json:${res.status}` };
  return json as FinancialSnapshotApiResponse;
};

export function useFinancialSnapshot(dealId: string | null | undefined) {
  const key = dealId ? `/api/deals/${dealId}/financial-snapshot` : null;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 15_000,
  });

  const notFound = data && !data.ok && data.error === "not_found";

  return {
    data: data && data.ok ? data : null,
    loading: Boolean(isLoading) && !data,
    error: error ? String(error) : data && !data.ok && !notFound ? data.error : null,
    notFound,
    refresh: mutate,
  };
}

import useSWR from "swr";

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return { ok: false, error: "not_found" };
  if (res.status === 403) return { ok: false, error: "forbidden" };
  if (res.status === 401) return { ok: false, error: "unauthorized" };
  if (!res.ok) return { ok: false, error: `http_${res.status}` };
  return res.json();
};

export function useFinancialSnapshotDecision(dealId: string | null | undefined) {
  const key = dealId ? `/api/deals/${dealId}/financial-snapshot/decision` : null;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 15_000,
    shouldRetryOnError: false,
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

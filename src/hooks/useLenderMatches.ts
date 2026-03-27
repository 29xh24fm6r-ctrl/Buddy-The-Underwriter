import useSWR from "swr";

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 403) return { ok: false, error: "forbidden" };
  if (res.status === 401) return { ok: false, error: "unauthorized" };
  if (!res.ok) return { ok: false, error: `http_${res.status}` };
  return res.json();
};

export function useLenderMatches(dealId: string | null | undefined) {
  const key = dealId ? `/api/deals/${dealId}/lenders/match` : null;
  const { data, error, isLoading } = useSWR(key, fetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 30_000,
    // Do not retry on auth errors — they won't resolve by retrying
    shouldRetryOnError: false,
  });

  return {
    data: data && data.ok ? data : null,
    loading: Boolean(isLoading) && !data,
    error: error ? String(error) : data && !data.ok ? data.error : null,
  };
}

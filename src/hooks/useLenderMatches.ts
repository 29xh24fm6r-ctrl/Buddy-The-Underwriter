import useSWR from "swr";

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" });
  return res.json();
};

export function useLenderMatches(dealId: string | null | undefined) {
  const key = dealId ? `/api/deals/${dealId}/lenders/match` : null;
  const { data, error, isLoading } = useSWR(key, fetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 30_000,
  });

  return {
    data: data && data.ok ? data : null,
    loading: Boolean(isLoading) && !data,
    error: error ? String(error) : data && !data.ok ? data.error : null,
  };
}

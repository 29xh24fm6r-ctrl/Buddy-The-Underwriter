export async function fetchExplainDeal(dealId: string) {
  const res = await fetch(`/api/deals/${dealId}/buddy/explain`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  if (!json?.ok) throw new Error(json?.error ?? "explain_failed");
  return json.markdown as string;
}

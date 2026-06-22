"use client";

import { useState, useEffect, useCallback } from "react";

export type DealMeta = {
  id: string;
  name: string | null;
  display_name: string | null;
  nickname: string | null;
  borrower_name: string | null;
  legal_name?: string | null;
  borrower_id?: string | null;
  name_locked: boolean;
  naming_method: string | null;
  naming_source: string | null;
  named_at?: string | null;
};

export function useDealMeta(dealId: string) {
  const [deal, setDeal] = useState<DealMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/name`);
      const json = await res.json();
      if (json.ok && json.deal) {
        setDeal({
          id: json.deal.id,
          name: json.deal.name ?? null,
          display_name: json.deal.display_name ?? null,
          nickname: json.deal.nickname ?? null,
          borrower_name: json.deal.borrower_name ?? null,
          legal_name: json.deal.legal_name ?? null,
          borrower_id: json.deal.borrower_id ?? null,
          name_locked: json.deal.name_locked ?? false,
          naming_method: json.deal.naming_method ?? null,
          naming_source: json.deal.naming_source ?? null,
          named_at: json.deal.named_at ?? null,
        });
        setError(null);
      } else {
        setError(json.error?.message ?? json.error ?? "Failed to load deal");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load deal";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { deal, loading, error, refresh, setDeal };
}

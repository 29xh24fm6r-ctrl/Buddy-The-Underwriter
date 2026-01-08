'use client';

import * as React from 'react';
import { Icon } from '@/components/ui/Icon';
import useSWR from 'swr';
import { onChecklistRefresh } from '@/lib/events/uiEvents';

const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then(async (res) => {
  const json = await res.json();
  console.log('[EnhancedChecklistCard] API Response:', {
    url,
    status: res.status,
    ok: json.ok,
    state: json.state,
    itemsCount: json.items?.length,
    firstItem: json.items?.[0],
    rawResponse: json
  });
  return json;
});

export function EnhancedChecklistCard({ dealId }: { dealId: string }) {
  const { data, error, isLoading, mutate } = useSWR(`/api/deals/${dealId}/checklist/list`, fetcher);

  // Listen for checklist refresh events
  React.useEffect(() => {
    const cleanup = onChecklistRefresh(dealId, () => {
      console.log('[EnhancedChecklistCard] Checklist refresh event received, revalidating...');
      mutate();
    });
    return cleanup;
  }, [dealId, mutate]);

  // Debug logging
  React.useEffect(() => {
    console.log('[EnhancedChecklistCard] DATA UPDATE:', {
      ok: data?.ok,
      state: data?.state,
      itemsCount: data?.items?.length,
      items: data?.items,
      error: error
    });
  }, [data, error]);

  const isProcessing = data?.state === 'processing';
  const items = data?.items || [];
  const normStatus = (s: any) => String(s || '').toLowerCase().trim();
  const received = items.filter((i: any) => {
    const st = normStatus(i.status);
    return st === 'received' || st === 'satisfied';
  });
  const pending = items.filter((i: any) => {
    const st = normStatus(i.status);
    return st === 'pending' || st === 'missing' || !st;
  });
  const optional = items.filter((i: any) => !i.required);
  
  console.log('[EnhancedChecklistCard] Items breakdown:', {
    total: items.length,
    received: received.length,
    pending: pending.length,
    optional: optional.length,
    statuses: items.map((i: any) => i.status)
  });

  if (isLoading || isProcessing) {
    return (
      <div className="rounded-xl border border-neutral-200 p-6 bg-white">
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Icon name="sync" className="h-4 w-4 animate-spin" />
          <span>{isProcessing ? 'Processing checklist...' : 'Loading checklist...'}</span>
        </div>
      </div>
    );
  }

  if (error || !data?.ok) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <div className="text-sm font-semibold text-red-900">Checklist failed to load</div>
        <div className="mt-2 text-xs text-red-800">{error?.message || data?.error}</div>
        <button onClick={() => mutate()} className="mt-2 text-xs underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm text-neutral-900">
      <div className="border-b border-neutral-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="checklist" className="h-5 w-5" />
            <h3 className="text-sm font-semibold">Deal Checklist</h3>
          </div>
          <button
            onClick={() => mutate()}
            className="rounded-lg border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            Refresh
          </button>
        </div>
        <div className="mt-3 flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1">
              <div className="h-2 w-2 rounded-full bg-emerald-600" />
              <span className="text-neutral-600">Received ({received.length})</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-2 w-2 rounded-full bg-amber-600" />
              <span className="text-neutral-600">Pending ({pending.length})</span>
            </div>
            {optional.length > 0 ? (
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 rounded-full bg-neutral-400" />
                <span className="text-neutral-600">Optional ({optional.length})</span>
              </div>
            ) : null}
        </div>
      </div>
      <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
        {items.length === 0 ? (
            <div className="text-center py-8 text-sm text-neutral-500">
              No checklist items yet. Click "Save + Auto-Seed Checklist" to generate items.
            </div>
          ) : (
            <>
              {/* Items renderings */}
            </>
        )}
      </div>
    </div>
  );
}

'use client';

import * as React from 'react';
import { Icon } from '@/components/ui/Icon';
import useSWR from 'swr';
import { onChecklistRefresh } from '@/lib/events/uiEvents';

type ChecklistItem = {
  id: string;
  checklist_key: string;
  title: string;
  description?: string | null;
  required: boolean;
  status: string;
  required_years?: number[] | null;
  satisfied_years?: number[] | null;
};

function normStatus(s: unknown) {
  return String(s || '').toLowerCase().trim();
}

function statusBadge(statusRaw: unknown) {
  const status = normStatus(statusRaw);
  if (status === 'received' || status === 'satisfied') {
    return {
      label: status.toUpperCase(),
      className: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    };
  }
  if (status === 'needs_review') {
    return {
      label: 'NEEDS REVIEW',
      className: 'border-yellow-200 bg-yellow-50 text-yellow-900',
    };
  }
  if (status === 'waived') {
    return {
      label: 'WAIVED',
      className: 'border-neutral-200 bg-neutral-50 text-neutral-800',
    };
  }
  if (status === 'pending') {
    return {
      label: 'PENDING',
      className: 'border-amber-200 bg-amber-50 text-amber-900',
    };
  }
  return {
    label: 'MISSING',
    className: 'border-amber-200 bg-amber-50 text-amber-900',
  };
}

function yearChips(checklistKey: unknown, requiredYears: unknown, satisfiedYears: unknown) {
  const key = String(checklistKey ?? '').toUpperCase();
  const isIrs = key.startsWith('IRS_BUSINESS') || key.startsWith('IRS_PERSONAL');
  const m = key.match(/_(\d)Y\b/);
  const requiredDistinct = isIrs && m ? Number(m[1]) : null;

  const req = Array.isArray(requiredYears)
    ? requiredYears.map((y) => Number(y)).filter((y) => Number.isFinite(y))
    : [];
  const sat = new Set<number>(
    Array.isArray(satisfiedYears)
      ? satisfiedYears.map((y) => Number(y)).filter((y) => Number.isFinite(y))
      : [],
  );

  // IRS keys satisfy by distinct-year count; show actual years received.
  // For other keys, prefer required years (when present) to show what's missing.
  const show = isIrs
    ? Array.from(sat).sort((a, b) => b - a)
    : req.length
      ? req.slice().sort((a, b) => b - a)
      : Array.from(sat).sort((a, b) => b - a);

  if (!show.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {show.map((y) => {
        const ok = sat.has(y);
        return (
          <span
            key={String(y)}
            className={
              ok
                ? 'rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-900'
                : 'rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-[11px] text-neutral-700'
            }
          >
            {y}
          </span>
        );
      })}
      {Number.isFinite(requiredDistinct as any) ? (
        <span className="ml-1 text-[11px] text-neutral-600">
          Distinct years: {sat.size}/{requiredDistinct}
        </span>
      ) : null}
    </div>
  );
}

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

export function EnhancedChecklistCard({
  dealId,
  onRefresh,
  isAdmin = false,
}: {
  dealId: string;
  onRefresh?: (refreshFn: () => Promise<void>) => void;
  isAdmin?: boolean;
}) {
  const { data, error, isLoading, mutate } = useSWR(
    `/api/deals/${dealId}/checklist/list`,
    fetcher,
  );

  const [togglingKey, setTogglingKey] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    await mutate();
  }, [mutate]);

  // Expose refresh function to parent (DealCockpitClient)
  React.useEffect(() => {
    if (!onRefresh) return;
    onRefresh(refresh);
  }, [onRefresh, refresh]);

  // Listen for checklist refresh events
  React.useEffect(() => {
    const cleanup = onChecklistRefresh(dealId, () => {
      console.log('[EnhancedChecklistCard] Checklist refresh event received, revalidating...');
      void refresh();
    });
    return cleanup;
  }, [dealId, refresh]);

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
  const items: ChecklistItem[] = (data?.items || []) as any;
  const received = items.filter((i: any) => {
    const st = normStatus(i.status);
    return st === 'received' || st === 'satisfied';
  });
  const pending = items.filter((i: any) => {
    const st = normStatus(i.status);
    return st === 'pending' || st === 'missing' || st === 'needs_review' || !st;
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

  async function toggleRequired(it: ChecklistItem) {
    if (!isAdmin) return;
    const checklistKey = String(it.checklist_key || '').trim();
    if (!checklistKey) return;

    setTogglingKey(checklistKey);
    try {
      const res = await fetch(`/api/deals/${dealId}/checklist/set-required`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ checklistKey, required: !it.required }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        console.error('[EnhancedChecklistCard] set-required failed', { checklistKey, json });
        return;
      }
      await refresh();
    } finally {
      setTogglingKey(null);
    }
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
            onClick={() => void refresh()}
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
              {items
                .slice()
                .sort((a, b) => {
                  // Received/satisfied first, then the rest, waived last.
                  const aStatus = normStatus(a.status);
                  const bStatus = normStatus(b.status);
                  const aGroup =
                    aStatus === 'received' || aStatus === 'satisfied'
                      ? 0
                      : aStatus === 'waived'
                        ? 2
                        : 1;
                  const bGroup =
                    bStatus === 'received' || bStatus === 'satisfied'
                      ? 0
                      : bStatus === 'waived'
                        ? 2
                        : 1;
                  if (aGroup !== bGroup) return aGroup - bGroup;
                  if (a.required !== b.required) return a.required ? -1 : 1;
                  return String(a.checklist_key).localeCompare(String(b.checklist_key));
                })
                .map((it) => {
                  const badge = statusBadge(it.status);
                  return (
                    <div key={it.id} className="rounded-lg border border-neutral-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                            {it.required ? (
                              <span className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] text-neutral-700">
                                Required
                              </span>
                            ) : (
                              <span className="rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-[11px] text-neutral-600">
                                Optional
                              </span>
                            )}
                            {isAdmin ? (
                              <button
                                type="button"
                                onClick={() => void toggleRequired(it)}
                                disabled={togglingKey === it.checklist_key}
                                className="rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-[11px] text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
                                title="Admin: toggle Required/Optional"
                              >
                                {it.required ? 'Make optional' : 'Make required'}
                              </button>
                            ) : null}
                            <span className="truncate rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-[11px] text-neutral-600">
                              {it.checklist_key}
                            </span>
                          </div>
                          <div className="mt-1 text-sm font-medium text-neutral-900">{it.title}</div>
                          {it.description ? (
                            <div className="mt-1 text-xs text-neutral-600">{it.description}</div>
                          ) : null}
                          {yearChips(it.checklist_key, it.required_years, it.satisfied_years)}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </>
        )}
      </div>
    </div>
  );
}

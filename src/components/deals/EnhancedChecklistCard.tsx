"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";

type ChecklistItem = {
  id: string;
  checklist_key: string;
  title: string;
  description: string | null;
  required: boolean;
  status?: string; // missing | received | waived
  received_at: string | null;
  satisfied_at?: string | null;
  satisfaction_json?: any;
  doc_type?: string | null;
  filename?: string | null;
  created_at?: string;
};

type DealEvent = {
  id: string;
  kind: string;
  input_json?: any;
  payload?: any;
  created_at: string;
};

async function j<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export function EnhancedChecklistCard({ 
  dealId,
  onRefresh,
}: { 
  dealId: string;
  onRefresh?: (refreshFn: () => Promise<void>) => void;
}) {
  const [items, setItems] = React.useState<ChecklistItem[]>([]);
  const [events, setEvents] = React.useState<DealEvent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showEvents, setShowEvents] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isReceived = (i: ChecklistItem) => Boolean(i?.satisfied_at) || i?.status === "received";
  const received = items.filter((i) => isReceived(i));
  const pending = items.filter((i) => i.required && !isReceived(i));
  const optional = items.filter((i) => !i.required && !isReceived(i));

  console.log("[EnhancedChecklistCard] Render state:", {
    totalItems: items.length,
    received: received.length,
    pending: pending.length,
    optional: optional.length,
    items: items.slice(0, 3), // Log first 3 items for debugging
  });

  const allRequiredReceived =
    items.filter((i) => i.required).length > 0 &&
    items.filter((i) => i.required && !i.received_at).length === 0;

  async function refresh() {
    console.log("[EnhancedChecklistCard] Refreshing checklist for deal:", dealId);
    setLoading(true);
    setError(null);
    try {
      // Fetch checklist items
      const checklistData = await j<{ ok: boolean; items: ChecklistItem[] }>(
        `/api/deals/${dealId}/checklist/list`
      );
      console.log("[EnhancedChecklistCard] Checklist data:", checklistData);
      setItems(checklistData.items || []);

      // Fetch recent deal events
      const eventsData = await j<{ events: DealEvent[] }>(
        `/api/deals/${dealId}/events?limit=10`
      );
      console.log("[EnhancedChecklistCard] Events data:", eventsData);
      setEvents(eventsData.events || []);
    } catch (e) {
      console.error("[EnhancedChecklistCard] Failed to refresh checklist:", e);
      setError(e instanceof Error ? e.message : "Failed to load checklist");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    console.log("[EnhancedChecklistCard] Component mounted for deal:", dealId);
    refresh();
    // Expose refresh function to parent
    if (onRefresh) {
      console.log("[EnhancedChecklistCard] Registering refresh callback with parent");
      onRefresh(refresh);
    }
    // Poll every 30 seconds for updates
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [dealId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 p-6 bg-white">
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Icon name="sync" className="h-4 w-4 animate-spin" />
          Loading checklist…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-red-900">Checklist failed to load</div>
          <button
            type="button"
            onClick={refresh}
            className="rounded-lg border border-red-300 px-2 py-1 text-xs hover:bg-red-100"
          >
            Retry
          </button>
        </div>
        <div className="mt-2 text-xs text-red-800">{error}</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm text-neutral-900">
      <div className="border-b border-neutral-200 p-4 text-neutral-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="checklist" className="h-5 w-5 text-neutral-900" />
            <h3 className="text-sm font-semibold">Deal Checklist</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowEvents(!showEvents)}
              className="rounded-lg border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              aria-label="Toggle event history"
            >
              <Icon name="history" className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={refresh}
              className="rounded-lg border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              aria-label="Refresh checklist"
            >
              <Icon name="refresh" className="h-3 w-3" />
            </button>
          </div>
        </div>

        {allRequiredReceived ? (
          <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
            <div className="flex items-center gap-2">
              <Icon name="check_circle" className="h-4 w-4" />
              <span className="font-semibold">All required items received</span>
            </div>
          </div>
        ) : null}

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
            {/* Received Items (show first for visibility) */}
            {received.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
                  ✅ Received ({received.length})
                </div>
                <div className="space-y-2">
                  {received.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-emerald-200 bg-emerald-50 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-emerald-900">
                            {item.title}
                            {item.required && (
                              <span className="ml-2 text-xs text-emerald-700">(required)</span>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-emerald-600">
                            Key: {item.checklist_key}
                            {item?.satisfaction_json?.requires_years ? (
                              <span className="ml-2">
                                Years: {(item?.satisfaction_json?.years || []).join(", ") || "—"} (
                                {item?.satisfaction_json?.year_count || 0}/{item?.satisfaction_json?.requires_years})
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-xs text-emerald-600">
                            Received:{" "}
                            {new Date(item.received_at!).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </div>
                        </div>
                        <Icon
                          name="check_circle"
                          className="h-4 w-4 text-emerald-600 shrink-0"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pending Required Items */}
            {pending.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
                  🔴 Pending Required ({pending.length})
                </div>
                <div className="space-y-2">
                  {pending.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-amber-200 bg-amber-50 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-amber-900">
                            {item.title}
                          </div>
                          {item.description && (
                            <div className="mt-1 text-xs text-amber-700">
                              {item.description}
                            </div>
                          )}
                          <div className="mt-1 text-xs text-amber-600">
                            Key: {item.checklist_key}
                            {item?.satisfaction_json?.requires_years ? (
                              <span className="ml-2">
                                Years: {(item?.satisfaction_json?.years || []).join(", ") || "—"} (
                                {item?.satisfaction_json?.year_count || 0}/{item?.satisfaction_json?.requires_years})
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <Icon name="pending" className="h-4 w-4 text-amber-600 shrink-0" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Optional Items */}
            {optional.length > 0 && (
              <details>
                <summary className="text-xs font-semibold uppercase tracking-wide text-neutral-500 cursor-pointer">
                  Optional Items ({optional.length})
                </summary>
                <div className="mt-2 space-y-2">
                  {optional.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-neutral-200 bg-neutral-50 p-3"
                    >
                      <div className="text-sm font-medium text-neutral-700">
                        {item.title}
                      </div>
                      {item.description && (
                        <div className="mt-1 text-xs text-neutral-600">
                          {item.description}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* All items exist but none match filters - shouldn't happen but handle gracefully */}
            {received.length === 0 && pending.length === 0 && optional.length === 0 && (
              <div className="text-center py-8 text-sm text-neutral-500">
                Checklist items found ({items.length}) but none are visible. This may indicate a data issue.
                <button
                  onClick={refresh}
                  className="mt-2 block mx-auto text-xs underline text-neutral-600 hover:text-neutral-900"
                >
                  Click to refresh
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Event Stream */}
      {showEvents && events.length > 0 ? (
        <div className="border-t border-neutral-200 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
            Recent Activity
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {events.map((event) => (
              <div
                key={event.id}
                className="rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <Icon name="event" className="h-3 w-3 text-neutral-500" />
                  <span className="font-medium">{event.kind}</span>
                  <span className="text-neutral-500 ml-auto">
                    {new Date(event.created_at).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                {((event.input_json as any)?.checklistKey || (event.payload as any)?.checklist_key) ? (
                  <div className="mt-1 text-neutral-600">
                    Item: {(event.input_json as any)?.checklistKey || (event.payload as any)?.checklist_key}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

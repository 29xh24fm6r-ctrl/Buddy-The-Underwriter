"use client";

/**
 * Phase 65F — Borrower Portal Progress
 *
 * Composite component: status banner + request checklist.
 * Fetches request-status from portal API and renders full borrower view.
 */

import { useState, useEffect } from "react";
import { BorrowerRequestStatusBanner } from "./BorrowerRequestStatusBanner";
import { BorrowerRequestChecklist } from "./BorrowerRequestChecklist";
import type { BorrowerItemStatus } from "@/core/borrower-orchestration/types";

type PortalProgress = {
  totalItems: number;
  completedItems: number;
  pendingItems: number;
  progressPercent: number;
  statusLabel: string;
};

type PortalItem = {
  id: string;
  title: string;
  description: string;
  status: BorrowerItemStatus;
  required: boolean;
  completedAt: string | null;
};

export function BorrowerPortalProgress({
  token,
  onItemClick,
}: {
  token: string;
  onItemClick?: (itemId: string) => void;
}) {
  const [progress, setProgress] = useState<PortalProgress | null>(null);
  const [items, setItems] = useState<PortalItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchStatus() {
      try {
        const res = await fetch(`/api/portal/${token}/request-status`);
        const json = await res.json();
        if (!cancelled && json.ok) {
          setProgress(json.progress);
          setItems(json.items ?? []);
        }
      } catch {
        // Silently fail — borrower portal degrades gracefully
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchStatus();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-16 rounded-lg bg-neutral-100" />
        <div className="h-24 rounded-lg bg-neutral-100" />
      </div>
    );
  }

  if (!progress || items.length === 0) return null;

  return (
    <div data-testid="borrower-portal-progress" className="space-y-4">
      <BorrowerRequestStatusBanner
        statusLabel={progress.statusLabel}
        progressPercent={progress.progressPercent}
        completedItems={progress.completedItems}
        totalItems={progress.totalItems}
      />
      <BorrowerRequestChecklist items={items} onItemClick={onItemClick} />
    </div>
  );
}

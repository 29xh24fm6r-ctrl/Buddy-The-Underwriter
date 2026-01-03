"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";

type NextBestUpload = {
  title: string;
  why: string;
  required: boolean;
};

type BorrowerStatusResponse = {
  ok: boolean;
  stage: string;
  message: string;
  nextBestUpload?: NextBestUpload;
};

export function BorrowerNextUploadCard({ 
  token,
  onUploadClick,
}: { 
  token: string;
  onUploadClick?: () => void;
}) {
  const [status, setStatus] = React.useState<BorrowerStatusResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  const fetchStatus = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/${token}/status`);
      if (!res.ok) throw new Error("Failed to load status");
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      console.error("Status fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, [token]);

  React.useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  React.useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchStatus();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchStatus]);

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="h-4 w-32 rounded bg-neutral-100" />
        <div className="mt-2 h-3 w-full rounded bg-neutral-100" />
        <div className="mt-4 h-10 w-full rounded-lg bg-neutral-100" />
      </div>
    );
  }

  if (!status || !status.ok) {
    return null;
  }

  const next = status.nextBestUpload;

  // If no missing items, show "all set" message
  if (!next) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white">
            <Icon name="check_circle" className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-emerald-900">You're all set</div>
            <div className="mt-1 text-xs text-emerald-800 opacity-90">
              We have everything we need right now. We'll reach out if anything changes.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white">
          <Icon name="cloud_upload" className="h-5 w-5 text-blue-600" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-blue-900">{next.title}</div>
          <div className="mt-1 text-xs text-blue-800 opacity-90">{next.why}</div>
          
          <button
            type="button"
            onClick={onUploadClick}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
          >
            <Icon name="cloud_upload" className="h-4 w-4 text-white" />
            Upload Now
          </button>

          {!next.required && (
            <div className="mt-2 text-xs text-blue-700 opacity-75">
              If you don't have this yet, upload later — I'll keep working.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

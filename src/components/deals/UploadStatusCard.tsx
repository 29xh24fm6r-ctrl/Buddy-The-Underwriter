'use client';

import * as React from 'react';
import { Icon } from '@/components/ui/Icon';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function UploadStatusCard({ dealId, onStatusChange }: { dealId: string, onStatusChange?: (status: any) => void }) {
  const { data, error, isLoading } = useSWR(`/api/deals/${dealId}/uploads/status`, fetcher, { refreshInterval: 2500 });

  React.useEffect(() => {
    if (data) {
      onStatusChange?.(data);
    }
  }, [data, onStatusChange]);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Icon name="sync" className="h-4 w-4 animate-spin" />
          <span>Loading upload status...</span>
        </div>
      </div>
    );
  }

  if (error || !data?.ok) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Failed to load upload status: {error?.message || data?.error}
      </div>
    );
  }

  const { total, processed, isProcessing, allDocsReceived, uploads } = data;

  if (total === 0) {
    return null; // Don't show the card if no documents have been uploaded
  }

  return (
    <div className={`rounded-xl border bg-white p-4 transition-all duration-300 ${isProcessing ? 'border-blue-200' : 'border-emerald-200'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isProcessing ? (
            <Icon name="sync" className="h-5 w-5 animate-spin text-blue-600" />
          ) : (
            <Icon name="check_circle" className="h-5 w-5 text-emerald-600" />
          )}
          <h3 className="text-sm font-semibold">Document Processing</h3>
        </div>
        <div className="text-sm text-neutral-600">
          {processed} / {total} documents processed
        </div>
      </div>

      {isProcessing && (
        <div className="mt-3 w-full rounded-full bg-neutral-200">
          <div
            className="rounded-full bg-blue-500 p-0.5 text-center text-xs font-medium leading-none text-blue-100 transition-all duration-500"
            style={{ width: `${(processed / total) * 100}%` }}
          >
            {Math.round((processed / total) * 100)}%
          </div>
        </div>
      )}

      {allDocsReceived && !isProcessing && (
        <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          All documents have been processed. You can now seed the checklist.
        </div>
      )}

      {isProcessing && uploads.filter((u: any) => u.status === 'processing').length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Currently Processing</div>
          <div className="max-h-32 overflow-y-auto space-y-1 pr-2">
            {uploads
              .filter((u: any) => u.status === 'processing')
              .map((u: any) => (
                <div key={u.id} className="text-xs text-neutral-600 truncate">
                  - {u.original_filename}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

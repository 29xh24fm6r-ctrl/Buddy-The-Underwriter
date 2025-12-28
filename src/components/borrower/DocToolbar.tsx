"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";

export function DocToolbar({
  filename,
  pageLabel,
  onPrev,
  onNext,
  onRemove,
  onUploadNewVersion,
}: {
  filename: string;
  pageLabel?: string;
  onPrev?: () => void;
  onNext?: () => void;
  onRemove?: () => void;
  onUploadNewVersion?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Icon name="file" className="h-4 w-4 text-neutral-700" />
          <div className="truncate text-sm font-medium">{filename}</div>
        </div>
        {pageLabel ? <div className="mt-1 text-xs text-neutral-500">{pageLabel}</div> : null}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900"
          aria-label="Previous page"
        >
          <Icon name="chevron_left" className="h-4 w-4" />
          Prev
        </button>

        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900"
          aria-label="Next page"
        >
          Next
          <Icon name="chevron_right" className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900"
          aria-label="Remove document"
        >
          <Icon name="delete" className="h-4 w-4" />
          Remove
        </button>

        <button
          type="button"
          onClick={onUploadNewVersion}
          className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900"
        >
          <Icon name="cloud_upload" className="h-4 w-4 text-white" />
          Upload new version
        </button>
      </div>
    </div>
  );
}

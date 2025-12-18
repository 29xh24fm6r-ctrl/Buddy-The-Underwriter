"use client";

import React, { useState } from "react";

export default function CollapsibleCard({
  title,
  subtitle,
  defaultOpen = true,
  anchorId,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  anchorId?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-white" id={anchorId}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{title}</div>
          {subtitle && <div className="text-sm text-gray-600">{subtitle}</div>}
        </div>
        <button
          className="border rounded px-3 py-1 text-sm hover:bg-gray-50 flex-shrink-0"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Collapse" : "Expand"}
        </button>
      </div>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

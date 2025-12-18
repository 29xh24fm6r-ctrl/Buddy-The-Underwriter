"use client";

import React from "react";
import type { PackDocument } from "@/lib/deals/pack/buildPackIndex";

export default function DocumentPreviewPanel({
  doc,
}: {
  doc: PackDocument | null;
}) {
  if (!doc) {
    return (
      <div className="rounded border bg-white p-3">
        <div className="text-sm font-semibold">Preview</div>
        <div className="mt-2 rounded bg-neutral-50 p-3 text-sm text-neutral-600">
          Select a document to preview.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">{doc.title ?? doc.file_name ?? "Document"}</div>
          <div className="text-xs text-neutral-500">{doc.doc_type}</div>
        </div>
        <div className="text-xs text-neutral-500">
          {Math.round((doc.confidence ?? 0) * 100)}%
        </div>
      </div>

      {/* Preview stub: wire to your existing stored file URL logic */}
      <div className="rounded border bg-neutral-50 p-3 text-sm text-neutral-700">
        Preview hookup TODO: render PDF iframe or image, using stored file URL for <code>{doc.source.file_id}</code>.
      </div>

      <div className="mt-3 rounded border p-2">
        <div className="text-xs font-semibold text-neutral-600">Why Buddy classified this:</div>
        <ul className="mt-1 list-disc pl-5 text-xs text-neutral-600">
          {(doc.reasons ?? []).slice(0, 6).map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
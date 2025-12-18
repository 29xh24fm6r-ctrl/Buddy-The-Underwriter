"use client";

import React, { useMemo } from "react";
import type { PackIndex, PackDocument } from "@/lib/deals/pack/buildPackIndex";
import type { PackScope } from "@/lib/packs/types";

type Props = {
  packIndex: PackIndex | null;
  scope: PackScope;
  onSelectDoc: (doc: PackDocument) => void;
};

function docsForScope(packIndex: PackIndex | null, scope: PackScope): PackDocument[] {
  if (!packIndex) return [];
  if (scope.kind === "ALL") return packIndex.allDocs ?? [];

  if (scope.kind === "TAX_YEAR") {
    const bucket = packIndex.taxReturns?.byYear?.[String(scope.year)];
    return bucket?.docs ?? [];
  }

  if (scope.kind === "PFS") return packIndex.pfs?.docs ?? [];
  if (scope.kind === "BUSINESS_FINANCIALS") return packIndex.businessFinancials?.docs ?? [];
  return packIndex.other?.docs ?? [];
}

export default function PackDetailPanel({ packIndex, scope, onSelectDoc }: Props) {
  const docs = useMemo(() => docsForScope(packIndex, scope), [packIndex, scope]);

  return (
    <div className="rounded border bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Pack Documents</div>
        <div className="text-xs text-neutral-500">{docs.length} items</div>
      </div>

      {docs.length === 0 ? (
        <div className="rounded bg-neutral-50 p-3 text-sm text-neutral-600">
          No documents in this section yet.
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <button
              key={d.doc_id}
              onClick={() => onSelectDoc(d)}
              className="w-full rounded border p-2 text-left hover:bg-neutral-50"
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{d.title ?? d.file_name ?? "Document"}</div>
                <div className="text-xs text-neutral-500">
                  {Math.round((d.confidence ?? 0) * 100)}%
                </div>
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                {d.doc_type} {d.year ? `• ${d.year}` : ""} {d.pages ? `• ${d.pages} pages` : ""}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
// src/components/borrower/MissingItemsCard.tsx
"use client";

import React, { useMemo, useState } from "react";
import type { PortalMissingItem, PortalPackSuggestion } from "@/lib/borrower/portalTypes";

function pillClasses(kind: string) {
  const k = String(kind || "").toUpperCase();
  if (k === "HIGH") return "border bg-foreground text-background";
  if (k === "MEDIUM") return "border bg-white";
  if (k === "LOW") return "border bg-muted/30";
  return "border bg-white";
}

function priorityLabel(p?: string | null) {
  const v = String(p || "").toUpperCase();
  if (v === "HIGH") return "Important";
  if (v === "MEDIUM") return "Recommended";
  if (v === "LOW") return "Optional";
  return "Item";
}

function statusLabel(s?: string | null) {
  const v = String(s || "").toUpperCase();
  if (v === "UPLOADED") return "Uploaded";
  if (v === "IN_REVIEW") return "In review";
  if (v === "OPTIONAL") return "Optional";
  return "Needed";
}

export default function MissingItemsCard({
  missingItems,
  bestSuggestion,
}: {
  missingItems: PortalMissingItem[];
  bestSuggestion: PortalPackSuggestion | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const display = useMemo(() => {
    const items = (missingItems || []).filter((x) => {
      const st = String(x.status || "").toUpperCase();
      // show "needed" items by default; keep optional if explicitly marked
      return st !== "UPLOADED";
    });

    const top = expanded ? items.slice(0, 30) : items.slice(0, 5);
    return { items, top };
  }, [missingItems, expanded]);

  const bestName = bestSuggestion?.pack_name || null;
  const missingCountFallback =
    typeof bestSuggestion?.missing_doc_count === "number" ? bestSuggestion.missing_doc_count : null;

  const hasList = display.items.length > 0;

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold">Next best uploads</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {bestName ? (
              <>
                Based on <span className="font-semibold text-foreground">{bestName}</span>, here are the most helpful
                items to upload next.
              </>
            ) : (
              <>Here are the most helpful items to upload next.</>
            )}
          </div>
        </div>

        {missingCountFallback !== null && (
          <div className="rounded-full border px-3 py-1 text-xs font-semibold">
            {missingCountFallback} needed
          </div>
        )}
      </div>

      {!hasList && (
        <div className="mt-4 rounded-xl border bg-muted/20 p-4">
          <div className="text-sm font-semibold">We'll generate your checklist automatically</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Upload a couple of key documents (anything you have), and we'll create a step-by-step checklist tailored to
            your file.
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Tip: Phone photos are fine — we'll organize everything for you.
          </div>
        </div>
      )}

      {hasList && (
        <>
          <div className="mt-4 space-y-3">
            {display.top.map((item, idx) => (
              <div key={item.id || `${item.title}-${idx}`} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{item.title}</div>

                    {!!item.description && (
                      <div className="mt-1 text-sm text-muted-foreground">{item.description}</div>
                    )}

                    {!!item.category_label && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Files under: <span className="font-medium text-foreground">{item.category_label}</span>
                      </div>
                    )}

                    {!!item.examples?.length && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Examples:{" "}
                        <span className="font-medium text-foreground">
                          {item.examples.slice(0, 2).join(", ")}
                          {item.examples.length > 2 ? "…" : ""}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="shrink-0 flex flex-col items-end gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${pillClasses(item.priority || "")}`}>
                      {priorityLabel(item.priority)}
                    </span>
                    <span className="rounded-full border bg-white px-3 py-1 text-xs font-semibold">
                      {statusLabel(item.status)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {display.items.length > 5 && (
            <button
              type="button"
              className="mt-4 w-full rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Show fewer" : `Show all (${display.items.length})`}
            </button>
          )}

          <div className="mt-3 text-xs text-muted-foreground">
            Don't worry about naming or organizing — just upload what you have.
          </div>
        </>
      )}
    </div>
  );
}

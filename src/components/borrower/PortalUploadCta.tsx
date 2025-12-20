// src/components/borrower/PortalUploadCta.tsx
"use client";

import React from "react";

export default function PortalUploadCta({ token }: { token: string }) {
  // This assumes your portal upload UX already exists somewhere on the page.
  // If your upload UI is on a separate route, change the href accordingly.
  const href = `/borrower/portal/upload?token=${encodeURIComponent(token)}`;

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold">Fastest way to finish</div>
      <div className="mt-2 text-sm text-muted-foreground">
        Drop in whatever you have — tax returns, bank statements, financials — and we'll automatically recognize and
        organize everything.
      </div>

      <a
        href={href}
        className="mt-4 inline-flex items-center justify-center rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background hover:opacity-90"
      >
        Upload documents
      </a>

      <div className="mt-3 text-xs text-muted-foreground">
        Tip: A phone photo is fine — we'll clean it up and route it correctly.
      </div>
    </div>
  );
}

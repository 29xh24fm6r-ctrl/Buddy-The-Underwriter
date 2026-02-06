// src/components/deals/interview/ShareUploadLinkCard.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback
    const el = document.createElement("textarea");
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
    return true;
  }
}

export default function ShareUploadLinkCard({
  dealId,
  sessionId,
  basePath = "/deals",
}: {
  dealId: string;
  sessionId: string | null;
  basePath?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);

  const uploadLink = useMemo(() => {
    const path = `${basePath}/${dealId}`;
    const qs = sessionId ? `?session=${encodeURIComponent(sessionId)}&focus=upload` : `?focus=upload`;
    return `${origin}${path}${qs}`;
  }, [dealId, sessionId, basePath, origin]);

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
      <div className="font-semibold">Share upload link</div>
      <div className="text-xs text-muted-foreground">
        Send this link to an accountant/partner so they can upload documents without typing anything.
      </div>

      <div className="rounded-lg border bg-muted/30 p-3">
        <div className="text-xs text-muted-foreground">Upload link</div>
        <div className="mt-2 break-all font-mono text-xs">{uploadLink}</div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            className={cx("rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90")}
            onClick={async () => {
              await copyToClipboard(uploadLink);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            Copy link
          </button>

          {copied ? <span className="text-sm text-emerald-600">Copied ✓</span> : null}

          <div className="ml-auto text-xs text-muted-foreground">
            Tip: add a note like "Please upload 2023/2022 business returns + interim P&amp;L."
          </div>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        (Optional hardening later) Add tokenized links + role-based upload permissions + expiration.
      </div>
    </div>
  );
}

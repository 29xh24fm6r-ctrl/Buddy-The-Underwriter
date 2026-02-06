"use client";

import { useEffect, useState } from "react";

export default function FrameGuard() {
  const [framed, setFramed] = useState(false);
  const [href, setHref] = useState("/");
  const isDev = process.env.NODE_ENV !== "production";

  useEffect(() => {
    if (!isDev) return;

    try {
      const isFramed = window.self !== window.top;
      setFramed(isFramed);
      setHref(window.location.href);
    } catch {
      setFramed(true);
      setHref(window.location.href);
    }
  }, [isDev]);

  if (!isDev || !framed) return null;

  return (
    <div className="fixed inset-0 z-[999999] grid place-items-center bg-black/80 p-6 text-white">
      <div className="pointer-events-auto w-full max-w-lg rounded-2xl border border-white/10 bg-[#0b0f14] p-6 shadow-2xl">
        <div className="text-lg font-semibold">Running inside an iframe</div>
        <div className="mt-2 text-sm text-white/70">
          Codespaces Preview embeds your app (iframe-in-iframe vibe). Open in a real tab for correct sizing.
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black"
            onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
          >
            Open in new tab
          </button>
          <button
            className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white"
            onClick={() => (window.top!.location.href = href)}
          >
            Break out of iframe
          </button>
        </div>
      </div>
    </div>
  );
}

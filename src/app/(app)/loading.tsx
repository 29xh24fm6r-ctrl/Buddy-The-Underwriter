"use client";

import { useState, useEffect } from "react";

export default function AppLoading() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-[40vh] flex items-center justify-center px-6">
      <div className="text-center space-y-3">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
        <div className="text-sm text-white/50">Loading...</div>
        {elapsed >= 8 && (
          <div className="text-xs text-amber-300/80 max-w-xs mx-auto">
            Still loading — if this persists, the server may be temporarily unavailable.{" "}
            <button
              onClick={() => window.location.reload()}
              className="underline underline-offset-2 hover:text-amber-200"
            >
              Hard refresh
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

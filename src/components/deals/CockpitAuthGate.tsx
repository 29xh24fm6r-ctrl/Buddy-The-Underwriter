"use client";

/**
 * Phase 58A — Auth-Safe Cockpit Mount Gate
 *
 * Prevents cockpit data-heavy panels from mounting before Clerk
 * client auth is loaded. Without this, endpoints fire during initial
 * navigation and receive 401s that the UI misinterprets as domain
 * absence ("Snapshot unavailable", "No lender matches").
 */

import { ReactNode, useState, useEffect } from "react";

export default function CockpitAuthGate({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Wait a tick for Clerk session to hydrate after client-side navigation.
    // This prevents the flash of 401 errors on initial cockpit mount.
    const timer = setTimeout(() => setReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  if (!ready) {
    return (
      <>
        {fallback ?? (
          <div className="min-h-[20vh] flex items-center justify-center text-sm text-white/30 animate-pulse">
            Loading secure deal context...
          </div>
        )}
      </>
    );
  }

  return <>{children}</>;
}

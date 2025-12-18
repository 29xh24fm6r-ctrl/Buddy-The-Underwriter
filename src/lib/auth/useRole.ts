"use client";

import { useEffect, useState } from "react";

export function useRole() {
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const r = await fetch("/api/auth/role", { cache: "no-store" });
        const j = await r.json();
        if (!cancelled && j?.ok) {
          setRole(j.role ?? null);
          setUserId(j.userId ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { role, userId, loading };
}

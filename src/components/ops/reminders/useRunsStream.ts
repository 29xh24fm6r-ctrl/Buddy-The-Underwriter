// src/components/ops/reminders/useRunsStream.ts
"use client";

import { useEffect, useRef, useState } from "react";
import type { ReminderRun } from "@/components/ops/reminders/RunFeed";

export function useRunsStream({
  enabled,
  status,
  subscriptionId,
  onRun,
}: {
  enabled: boolean;
  status: string;
  subscriptionId: string;
  onRun: (run: ReminderRun) => void;
}) {
  const [streamStatus, setStreamStatus] = useState<"connecting" | "open" | "closed" | "error">("closed");
  const intervalRef = useRef<any>(null);
  const lastSeenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    
    // Simulate "live" with fast polling (500ms)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStreamStatus("connecting");
    
    const poll = async () => {
      try {
        const params = new URLSearchParams();
        params.set("limit", "10");
        if (status) params.set("status", status);
        if (subscriptionId.trim()) params.set("subscription_id", subscriptionId.trim());

        const res = await fetch(`/api/admin/reminders/runs?${params.toString()}`, { cache: "no-store" });
        const json = await res.json().catch(() => null);

        if (json?.ok && Array.isArray(json.runs)) {
          setStreamStatus("open");
          
          // Emit new runs
          const runs = json.runs as ReminderRun[];
          for (const run of runs.reverse()) {
            if (run.id !== lastSeenRef.current) {
              onRun(run);
              lastSeenRef.current = run.id;
            }
          }
        } else {
          setStreamStatus("error");
        }
      } catch {
        setStreamStatus("error");
      }
    };

    poll();
    intervalRef.current = setInterval(poll, 500);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setStreamStatus("closed");
    };
  }, [enabled, status, subscriptionId, onRun]);

  return { streamStatus };
}

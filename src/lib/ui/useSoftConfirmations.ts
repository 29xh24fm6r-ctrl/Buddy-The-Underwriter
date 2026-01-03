"use client";

import { useCallback, useState } from "react";

/**
 * SoftConfirmation
 *
 * Lightweight, non-blocking confirmation message.
 * Used for subtle UX feedback (e.g. "Checklist updated").
 */
export type SoftConfirmation = {
  id: string;
  message: string;
  timestamp: number;
};

/**
 * useSoftConfirmations
 *
 * Subtle, auto-dismissing confirmation system.
 *
 * Rules:
 * - Non-blocking
 * - Auto-dismiss after 2.5s
 * - Never throws
 * - Safe to call repeatedly
 */
export function useSoftConfirmations() {
  const [items, setItems] = useState<SoftConfirmation[]>([]);

  const push = useCallback((message: string) => {
    const id = crypto.randomUUID();
    const timestamp = Date.now();

    setItems((prev) => [...prev, { id, message, timestamp }]);

    // Auto-dismiss after 2.5 seconds
    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, 2500);
  }, []);

  const clear = useCallback(() => {
    setItems([]);
  }, []);

  return {
    items,
    push,
    clear,
  };
}

"use client";

import { useCallback, useState } from "react";

export type SoftConfirmation = {
  id: string;
  message: string;
  timestamp: number;
};

/**
 * useSoftConfirmations - Subtle, auto-dismissing confirmations
 * 
 * Shows calm feedback for state changes without demanding attention.
 * Messages auto-dismiss after 2.5 seconds.
 * 
 * Rules:
 * - Never trigger on page load
 * - Never trigger repeatedly for same state
 * - Only trigger on real state changes
 * - Non-blocking, informational only
 */
export function useSoftConfirmations() {
  const [items, setItems] = useState<SoftConfirmation[]>([]);

  const push = useCallback((message: string) => {
    const id = crypto.randomUUID();
    const timestamp = Date.now();
    
    setItems((v) => [...v, { id, message, timestamp }]);

    // Auto-dismiss after 2.5 seconds
    setTimeout(() => {
      setItems((v) => v.filter((i) => i.id !== id));
    }, 2500);
  }, []);

  const clear = useCallback(() => {
    setItems([]);
  }, []);

  return { items, push, clear };
}

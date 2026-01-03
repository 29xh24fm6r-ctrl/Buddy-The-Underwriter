"use client";

import { useCallback, useState } from "react";

export type SoftConfirmation = { id: string; message: string };

export function useSoftConfirmations() {
  const [items, setItems] = useState<SoftConfirmation[]>([]);

  const push = useCallback((message: string) => {
    const id = crypto.randomUUID();
    setItems((v) => [...v, { id, message }]);

    window.setTimeout(() => {
      setItems((v) => v.filter((i) => i.id !== id));
    }, 2500);
  }, []);

  return { items, push };
}

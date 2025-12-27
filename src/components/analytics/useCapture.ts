"use client";

import { useCallback } from "react";
import posthog from "posthog-js";

export function useCapture() {
  return useCallback((event: string, props?: Record<string, any>) => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return; // Safe no-op if not configured
    posthog.capture(event, props);
  }, []);
}

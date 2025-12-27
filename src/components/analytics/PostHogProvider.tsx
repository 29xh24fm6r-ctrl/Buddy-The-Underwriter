"use client";

import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { useEffect } from "react";

export function PHProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://app.posthog.com";

    if (!key) return; // Safe no-op if not configured
    if ((posthog as any).__loaded) return;

    posthog.init(key, {
      api_host: host,
      capture_pageview: true,
      capture_pageleave: true,
    });

    (posthog as any).__loaded = true;
  }, []);

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}

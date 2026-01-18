"use client";

import { useBuddyContext } from "@/buddy/core/BuddyProvider";

export function useBuddy() {
  return useBuddyContext();
}

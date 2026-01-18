"use client";

import { useCallback } from "react";
import type { BuddySignal } from "@/buddy/types";
import { useBuddy } from "@/buddy/core/useBuddy";

export function useBuddySignal() {
  const { emit } = useBuddy();
  return useCallback((sig: BuddySignal) => emit(sig), [emit]);
}

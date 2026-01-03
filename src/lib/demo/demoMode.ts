/**
 * Demo Mode Detection
 * 
 * Allows sales/demo scenarios without data setup:
 * - ?__mode=demo activates demo mode
 * - &__state=empty|converging|ready|blocked controls state
 * - &__deal=acme optional deal identifier
 * 
 * SECURITY: Never mutates prod data, read-only mocks
 */

export function isDemoMode(searchParams: URLSearchParams | any): boolean {
  if (searchParams instanceof URLSearchParams) {
    return searchParams.get("__mode") === "demo";
  }
  
  // Handle Next.js searchParams object
  return searchParams?.__mode === "demo";
}

export type DemoState = "empty" | "converging" | "ready" | "blocked";

export function demoState(searchParams: URLSearchParams | any): DemoState {
  let state: string | null = null;

  if (searchParams instanceof URLSearchParams) {
    state = searchParams.get("__state");
  } else {
    state = searchParams?.__state ?? null;
  }

  const validStates: DemoState[] = ["empty", "converging", "ready", "blocked"];
  
  if (state && validStates.includes(state as DemoState)) {
    return state as DemoState;
  }

  return "converging"; // Default demo state
}

export function demoDeal(searchParams: URLSearchParams | any): string {
  if (searchParams instanceof URLSearchParams) {
    return searchParams.get("__deal") ?? "acme";
  }
  
  return searchParams?.__deal ?? "acme";
}

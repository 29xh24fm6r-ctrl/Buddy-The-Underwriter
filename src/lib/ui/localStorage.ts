// src/lib/ui/localStorage.ts

export function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function safeGetLocalStorage(key: string): string | null {
  if (!canUseLocalStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetLocalStorage(key: string, value: string): void {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export function safeRemoveLocalStorage(key: string): void {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function safeGetJson<T>(key: string): T | null {
  const raw = safeGetLocalStorage(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function safeSetJson<T>(key: string, value: T): void {
  try {
    safeSetLocalStorage(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}
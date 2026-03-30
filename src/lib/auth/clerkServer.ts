// src/lib/auth/clerkServer.ts
import "server-only";

import type { NextRequest } from "next/server";

function isPlaceholder(v?: string | null) {
  if (!v) return true;
  const s = String(v).trim();
  if (!s) return true;
  return (
    s === "pk_test" ||
    s === "pk_live" ||
    s === "sk_test" ||
    s === "sk_live" ||
    s === "test" ||
    s === "placeholder" ||
    s === "REPLACE_ME" ||
    s.includes("YOUR_") ||
    s.includes("PLACEHOLDER") ||
    s.includes("clerk.") ||
    s.includes("xxxxx")
  );
}

export function isClerkConfigured() {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const sk = process.env.CLERK_SECRET_KEY;
  return !isPlaceholder(pk) && !isPlaceholder(sk);
}

export type SafeAuth = {
  userId: string | null;
  sessionId: string | null;
  getToken: (opts?: { template?: string }) => Promise<string | null>;
};

// ─── Timeout errors ───────────────────────────────────────────────────────────

export class ClerkTimeoutError extends Error {
  code = "clerk_auth_timeout";
  constructor(message = "Clerk auth timed out") {
    super(message);
    this.name = "ClerkTimeoutError";
  }
}

export class ClerkCurrentUserTimeoutError extends Error {
  code = "clerk_current_user_timeout";
  constructor(message = "Clerk currentUser timed out") {
    super(message);
    this.name = "ClerkCurrentUserTimeoutError";
  }
}

// ─── Bounded wrappers ─────────────────────────────────────────────────────────

/**
 * Bounded Clerk auth with timeout.
 * Prevents indefinite hangs on server routes.
 */
export async function safeClerkAuth(timeoutMs = 5000): Promise<SafeAuth> {
  const nullAuth: SafeAuth = { userId: null, sessionId: null, getToken: async () => null };
  if (!isClerkConfigured()) return nullAuth;

  const start = Date.now();
  console.log("[clerk] auth start");

  try {
    const mod = await import("@clerk/nextjs/server");
    const a = await Promise.race([
      mod.auth(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new ClerkTimeoutError()), timeoutMs),
      ),
    ]);
    console.log("[clerk] auth done", `${Date.now() - start}ms`);
    return {
      userId: a.userId ?? null,
      sessionId: a.sessionId ?? null,
      getToken: a.getToken,
    };
  } catch (e) {
    if (e instanceof ClerkTimeoutError) {
      console.error("[clerk] auth TIMEOUT", `${Date.now() - start}ms`);
      throw e;
    }
    console.error("[clerkAuth] failed:", e);
    return nullAuth;
  }
}

/**
 * Bounded Clerk currentUser with timeout.
 * For enrichment only — never block a route on this.
 */
export async function safeClerkCurrentUser(timeoutMs = 3000) {
  if (!isClerkConfigured()) return null;

  const start = Date.now();
  console.log("[clerk] currentUser start");

  try {
    const mod = await import("@clerk/nextjs/server");
    const result = await Promise.race([
      mod.currentUser(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new ClerkCurrentUserTimeoutError()), timeoutMs),
      ),
    ]);
    console.log("[clerk] currentUser done", `${Date.now() - start}ms`);
    return result;
  } catch (e) {
    if (e instanceof ClerkCurrentUserTimeoutError) {
      console.warn("[clerk] currentUser TIMEOUT", `${Date.now() - start}ms`);
      throw e;
    }
    console.error("[clerkCurrentUser] failed:", e);
    return null;
  }
}

// ─── Legacy wrappers (preserved for backward compat — now bounded) ────────────

export async function clerkAuth(_req?: NextRequest): Promise<SafeAuth> {
  return safeClerkAuth(5000);
}

export async function clerkCurrentUser() {
  try {
    return await safeClerkCurrentUser(3000);
  } catch {
    return null;
  }
}

export async function clerkClient() {
  if (!isClerkConfigured()) return null;
  const mod = await import("@clerk/nextjs/server");
  return await mod.clerkClient();
}

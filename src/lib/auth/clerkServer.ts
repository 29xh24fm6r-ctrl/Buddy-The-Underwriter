// src/lib/auth/clerkServer.ts
import "server-only";

// Purpose: prevent CI/build/runtime crashes when Clerk env vars are missing/placeholder.
// We avoid top-level imports from @clerk/nextjs/server and instead dynamically import only when configured.

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
  // We treat missing OR obvious placeholders as "not configured".
  return !isPlaceholder(pk) && !isPlaceholder(sk);
}

export type SafeAuth = {
  userId: string | null;
  sessionId: string | null;
  getToken: (opts?: { template?: string }) => Promise<string | null>;
};

export async function clerkAuth(_req?: NextRequest): Promise<SafeAuth> {
  const nullAuth: SafeAuth = { userId: null, sessionId: null, getToken: async () => null };
  if (!isClerkConfigured()) return nullAuth;
  try {
    const mod = await import("@clerk/nextjs/server");
    // auth() signature does not require req in App Router; keep param for flexibility.
    const a = await mod.auth();
    return {
      userId: a.userId ?? null,
      sessionId: a.sessionId ?? null,
      getToken: a.getToken,
    };
  } catch (e) {
    console.error("[clerkAuth] failed:", e);
    return nullAuth;
  }
}

export async function clerkCurrentUser() {
  if (!isClerkConfigured()) return null;
  const mod = await import("@clerk/nextjs/server");
  return mod.currentUser();
}

export async function clerkClient() {
  if (!isClerkConfigured()) return null;
  const mod = await import("@clerk/nextjs/server");
  return await mod.clerkClient();
}

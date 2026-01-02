"use client";

import * as React from "react";
import { ClerkProvider } from "@clerk/nextjs";

function isValidClerkKey(key: string | undefined) {
  if (!key) return false;
  if (!key.startsWith("pk_")) return false;
  if (key.includes("placeholder")) return false;
  if (key.includes("pk_test_placeholder")) return false;
  return true;
}

export default function ClerkGate({ children }: { children: React.ReactNode }) {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  // ✅ In CI / preview builds we often use placeholder env vars.
  // If the key is invalid, do NOT mount ClerkProvider (prevents prerender crash).
  if (!isValidClerkKey(pk)) return <>{children}</>;

  return <ClerkProvider publishableKey={pk}>{children}</ClerkProvider>;
}

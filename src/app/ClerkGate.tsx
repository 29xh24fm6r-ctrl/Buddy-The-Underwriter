"use client";

import * as React from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { isValidClerkPublishableKey } from "@/lib/auth/isValidClerkKey";

export default function ClerkGate({ children }: { children: React.ReactNode }) {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  // ✅ In CI / preview builds we often use placeholder env vars.
  // If the key is invalid, do NOT mount ClerkProvider (prevents prerender crash).
  if (!isValidClerkPublishableKey(pk)) return <>{children}</>;

  return <ClerkProvider publishableKey={pk}>{children}</ClerkProvider>;
}

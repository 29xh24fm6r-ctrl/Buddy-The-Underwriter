"use client";

import Link from "next/link";
import { useProfile } from "@/hooks/useProfile";

/**
 * Soft-gate banner shown when the user's display name is missing.
 * Renders nothing when profile is complete or still loading.
 */
export function ProfileCompletionBanner() {
  const { profile } = useProfile();

  // Still loading or profile is complete — render nothing
  if (!profile || profile.display_name) return null;

  return (
    <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-center text-sm text-amber-200">
      Your profile is incomplete.{" "}
      <Link href="/profile" className="font-semibold underline underline-offset-2 hover:text-amber-100">
        Add your display name
      </Link>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";

export type ProfileData = {
  id: string;
  clerk_user_id: string;
  bank_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

export type ProfileState = {
  profile: ProfileData | null;
  schemaMismatch: boolean;
};

/**
 * Client-side hook to fetch the current user's profile for avatar/display in nav.
 * Fails silently — returns null profile if unavailable.
 * Surfaces schema_mismatch flag so UI can show a degraded hint.
 */
export function useProfile(): ProfileState {
  const [state, setState] = useState<ProfileState>({
    profile: null,
    schemaMismatch: false,
  });

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && json.profile) {
          setState({ profile: json.profile, schemaMismatch: false });
        } else if (json.error === "schema_mismatch") {
          // Schema not migrated yet — show degraded profile (no avatar/display_name)
          setState({
            profile: json.profile ?? null,
            schemaMismatch: true,
          });
        }
        // Other errors: silently degrade — avatar just won't show
      })
      .catch(() => {
        // Network error — silently degrade
      });
  }, []);

  return state;
}

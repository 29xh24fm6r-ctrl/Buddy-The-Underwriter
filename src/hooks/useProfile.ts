"use client";

import { useState, useEffect, useCallback } from "react";

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
 * Re-fetches when a "profile-updated" custom event fires (e.g. after profile save).
 */
export function useProfile(): ProfileState {
  const [state, setState] = useState<ProfileState>({
    profile: null,
    schemaMismatch: false,
  });

  const fetchProfile = useCallback(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && json.profile) {
          setState({ profile: json.profile, schemaMismatch: false });
        } else if (json.error === "schema_mismatch") {
          setState({
            profile: json.profile ?? null,
            schemaMismatch: true,
          });
        }
      })
      .catch(() => {
        // Network error — silently degrade
      });
  }, []);

  useEffect(() => {
    fetchProfile();

    // Re-fetch when profile is updated elsewhere (e.g. ProfileClient save)
    const handler = () => fetchProfile();
    window.addEventListener("profile-updated", handler);
    return () => window.removeEventListener("profile-updated", handler);
  }, [fetchProfile]);

  return state;
}

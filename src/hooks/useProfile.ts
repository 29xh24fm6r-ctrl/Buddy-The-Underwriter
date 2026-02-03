"use client";

import { useState, useEffect, useCallback } from "react";

export type ProfileData = {
  id: string;
  clerk_user_id: string;
  bank_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

export type CurrentBank = {
  id: string;
  name: string;
  logo_url?: string | null;
  website_url?: string | null;
};

export type ProfileState = {
  profile: ProfileData | null;
  currentBank: CurrentBank | null;
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
    currentBank: null,
    schemaMismatch: false,
  });

  const fetchProfile = useCallback(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && json.profile) {
          setState({ profile: json.profile, currentBank: json.current_bank ?? null, schemaMismatch: false });
        } else if (json.error === "schema_mismatch") {
          setState({
            profile: json.profile ?? null,
            currentBank: json.current_bank ?? null,
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

    // Re-fetch when profile or bank context is updated elsewhere
    const handler = () => fetchProfile();
    window.addEventListener("profile-updated", handler);
    window.addEventListener("bank-context-updated", handler);
    return () => {
      window.removeEventListener("profile-updated", handler);
      window.removeEventListener("bank-context-updated", handler);
    };
  }, [fetchProfile]);

  return state;
}

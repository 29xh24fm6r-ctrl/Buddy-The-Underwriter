"use client";

import { useState, useEffect } from "react";

export type ProfileData = {
  id: string;
  clerk_user_id: string;
  bank_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

/**
 * Client-side hook to fetch the current user's profile for avatar/display in nav.
 * Fails silently — returns null if profile unavailable.
 */
export function useProfile() {
  const [profile, setProfile] = useState<ProfileData | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && json.profile) {
          setProfile(json.profile);
        }
      })
      .catch(() => {
        // Silently degrade — avatar just won't show
      });
  }, []);

  return profile;
}

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
export function useProfile(): ProfileState & { error: string | null; loading: boolean } {
  const [state, setState] = useState<ProfileState & { error: string | null; loading: boolean }>({
    profile: null,
    currentBank: null,
    schemaMismatch: false,
    error: null,
    loading: true,
  });

  const fetchProfile = useCallback(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    fetch("/api/profile", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) {
          console.error("[useProfile] fetch failed:", r.status);
          throw new Error(`profile_fetch_${r.status}`);
        }
        return r.json();
      })
      .then((json) => {
        if (json.ok && json.profile) {
          setState({ profile: json.profile, currentBank: json.current_bank ?? null, schemaMismatch: false, error: null, loading: false });
        } else if (json.error === "schema_mismatch") {
          setState({
            profile: json.profile ?? null,
            currentBank: json.current_bank ?? null,
            schemaMismatch: true,
            error: "schema_mismatch",
            loading: false,
          });
        } else {
          // Profile may be null (no profile yet) — that's valid
          setState({
            profile: json.profile ?? null,
            currentBank: json.current_bank ?? null,
            schemaMismatch: false,
            error: json.error ?? null,
            loading: false,
          });
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : "profile_fetch_failed";
        console.error("[useProfile] error:", msg);
        setState((prev) => ({ ...prev, error: msg, loading: false }));
      })
      .finally(() => clearTimeout(timeout));
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

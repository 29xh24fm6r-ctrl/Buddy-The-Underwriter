"use client";

import { useState, useEffect, useRef } from "react";

type Profile = {
  id: string;
  clerk_user_id: string;
  bank_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

type Membership = {
  bank_id: string;
  bank_name: string;
  role: string;
};

type CurrentBank = {
  id: string;
  name: string;
};

export default function ProfileClient() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schemaMismatch, setSchemaMismatch] = useState(false);

  // Bank context
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentBank, setCurrentBank] = useState<CurrentBank | null>(null);

  // Form state
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [switchingBank, setSwitchingBank] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dirty tracking: last-saved values
  const [savedDisplayName, setSavedDisplayName] = useState("");
  const [savedAvatarUrl, setSavedAvatarUrl] = useState("");

  const isDirty =
    displayName !== savedDisplayName || avatarUrl !== savedAvatarUrl;

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((json) => {
        // Bank context (returned for both ok and schema_mismatch)
        if (json.memberships) setMemberships(json.memberships);
        if (json.current_bank) setCurrentBank(json.current_bank);

        if (json.ok && json.profile) {
          setProfile(json.profile);
          const dn = json.profile.display_name ?? "";
          const au = json.profile.avatar_url ?? "";
          setDisplayName(dn);
          setAvatarUrl(au);
          setSavedDisplayName(dn);
          setSavedAvatarUrl(au);
        } else if (json.error === "schema_mismatch") {
          setSchemaMismatch(true);
          if (json.profile) {
            setProfile(json.profile);
          }
        } else {
          setError(json.error ?? "Failed to load profile");
        }
      })
      .catch(() => setError("Network error"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim() || null,
          avatar_url: avatarUrl.trim() || null,
        }),
      });
      const json = await res.json();
      if (json.ok && json.profile) {
        const dn = json.profile.display_name ?? "";
        const au = json.profile.avatar_url ?? "";
        setProfile(json.profile);
        setDisplayName(dn);
        setAvatarUrl(au);
        setSavedDisplayName(dn);
        setSavedAvatarUrl(au);
        setSaveMsg("Saved");
        // Notify other components (e.g. HeroBar) to re-fetch profile
        window.dispatchEvent(new Event("profile-updated"));
      } else {
        setSaveMsg(json.error ?? "Save failed");
      }
    } catch {
      setSaveMsg("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleFileUpload(file: File) {
    if (!file.type.startsWith("image/")) return;
    // Convert to data URL for simplicity (works without external storage)
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setAvatarUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  async function handleBankSwitch(bankId: string) {
    if (bankId === currentBank?.id) return;
    setSwitchingBank(true);
    try {
      const res = await fetch("/api/profile/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bank_id: bankId }),
      });
      const json = await res.json();
      if (json.ok) {
        // Bank context changed — full reload so all server components pick up the new cookie
        window.location.reload();
      } else {
        setSaveMsg(json.error ?? "Bank switch failed");
        setSwitchingBank(false);
      }
    } catch {
      setSaveMsg("Network error");
      setSwitchingBank(false);
    }
  }

  if (loading) {
    return <div className="text-white/60 text-sm">Loading profile...</div>;
  }

  if (error) {
    return <div className="text-rose-400 text-sm">{error}</div>;
  }

  const initials = (displayName || profile?.clerk_user_id || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="space-y-6">
      {schemaMismatch && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <strong>Profile schema pending migration.</strong>{" "}
          Display name and avatar fields are not yet available in production.
          Run migration <code className="text-amber-300">20260202_profiles_avatar.sql</code> in Supabase.
        </div>
      )}

      {/* Avatar preview */}
      <div className="flex items-center gap-4">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt="Avatar"
            className="h-16 w-16 rounded-full object-cover border-2 border-white/10"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/20 border-2 border-white/10 text-lg font-bold text-white">
            {initials}
          </div>
        )}
        <div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10"
          >
            Upload avatar
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
            }}
          />
          {avatarUrl && (
            <button
              type="button"
              onClick={() => setAvatarUrl("")}
              className="ml-2 text-xs text-white/50 hover:text-white/80"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Display name */}
      <div>
        <label className="block text-sm font-medium text-white/70 mb-1">
          Display name
        </label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name"
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30"
        />
      </div>

      {/* Avatar URL (manual) */}
      <div>
        <label className="block text-sm font-medium text-white/70 mb-1">
          Avatar URL
        </label>
        <input
          value={avatarUrl.startsWith("data:") ? "(uploaded file)" : avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
          placeholder="https://..."
          disabled={avatarUrl.startsWith("data:")}
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 disabled:opacity-50"
        />
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
        {saveMsg && (
          <span
            className={`text-sm ${saveMsg === "Saved" ? "text-emerald-400" : "text-rose-400"}`}
          >
            {saveMsg}
          </span>
        )}
      </div>

      {/* Bank context */}
      {(currentBank || memberships.length > 0) && (
        <div className="border-t border-white/10 pt-4 space-y-3">
          {currentBank && memberships.length <= 1 && (
            <div className="text-sm text-white/80">
              <span className="text-white/50">Current Bank:</span>{" "}
              <span className="font-medium">{currentBank.name}</span>
            </div>
          )}
          {memberships.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-white/70 mb-1">
                Active Bank
              </label>
              <select
                value={currentBank?.id ?? ""}
                onChange={(e) => handleBankSwitch(e.target.value)}
                disabled={switchingBank}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {!currentBank && <option value="">Select a bank...</option>}
                {memberships.map((m) => (
                  <option key={m.bank_id} value={m.bank_id}>
                    {m.bank_name} ({m.role})
                  </option>
                ))}
              </select>
              {switchingBank && (
                <div className="mt-1 text-xs text-white/50">Switching bank...</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Meta info */}
      <div className="border-t border-white/10 pt-4 text-xs text-white/40 space-y-1">
        <div>User ID: {profile?.clerk_user_id}</div>
        {profile?.bank_id && <div>Bank ID: {profile.bank_id}</div>}
      </div>
    </div>
  );
}

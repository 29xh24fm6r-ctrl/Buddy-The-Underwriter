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

// Input styling constants
const INPUT_CLS =
  "w-full rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-white " +
  "placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20";
const DISABLED_INPUT_CLS = `${INPUT_CLS} disabled:opacity-50 disabled:cursor-not-allowed`;

export default function ProfileClient() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schemaMismatch, setSchemaMismatch] = useState(false);

  // Additional context from API
  const [email, setEmail] = useState<string | null>(null);
  const [currentBankRole, setCurrentBankRole] = useState<string | null>(null);

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

  // Create bank form
  const [showCreateBank, setShowCreateBank] = useState(false);
  const [newBankName, setNewBankName] = useState("");
  const [creatingBank, setCreatingBank] = useState(false);

  // Copy diagnostics state
  const [copied, setCopied] = useState(false);

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
        if (json.email) setEmail(json.email);
        if (json.current_bank_role) setCurrentBankRole(json.current_bank_role);

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

  async function handleCreateBank() {
    if (!newBankName.trim()) return;
    setCreatingBank(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/banks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newBankName.trim() }),
      });
      const json = await res.json();
      if (json.ok) {
        // Bank created + set as current — reload to propagate
        window.location.reload();
      } else {
        setSaveMsg(json.error ?? "Bank creation failed");
      }
    } catch {
      setSaveMsg("Network error");
    } finally {
      setCreatingBank(false);
    }
  }

  function handleCopyDiagnostics() {
    const diagnostics = {
      url: typeof window !== "undefined" ? window.location.href : "",
      build: {
        sha: process.env.NEXT_PUBLIC_GIT_SHA ?? "unknown",
        env: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
        time: process.env.NEXT_PUBLIC_BUILD_TIME ?? "unknown",
      },
      user: {
        clerkUserId: profile?.clerk_user_id ?? "unknown",
        email: email ?? "unknown",
        profileId: profile?.id ?? "unknown",
      },
      bank: {
        id: currentBank?.id ?? "none",
        name: currentBank?.name ?? "none",
        role: currentBankRole ?? "none",
      },
    };

    navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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
    <div className="space-y-8">
      {/* Header */}
      <header>
        <h1 className="text-2xl font-semibold text-white">Profile</h1>
        <p className="mt-1 text-white/60">Update your identity and confirm your bank context.</p>
      </header>

      {schemaMismatch && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <strong>Profile schema pending migration.</strong>{" "}
          Display name and avatar fields are not yet available in production.
          Run migration <code className="text-amber-300">20260202_profiles_avatar.sql</code> in Supabase.
        </div>
      )}

      {/* Section 1: Identity (editable) */}
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-5">
        <h2 className="text-xs font-bold uppercase tracking-widest text-white/50">
          Identity
        </h2>

        {/* Avatar preview */}
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt="Avatar"
              className="h-16 w-16 rounded-full object-cover border-2 border-white/20 shadow-lg"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/20 border-2 border-white/20 text-lg font-bold text-white shadow-lg">
              {initials}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10 transition-colors"
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
                className="text-xs text-white/50 hover:text-white/80 transition-colors"
              >
                Remove
              </button>
            )}
          </div>
        </div>

        {/* Display name */}
        <div>
          <label className="block text-sm font-medium text-white/90 mb-1.5">
            Display name
          </label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            className={INPUT_CLS}
          />
        </div>

        {/* Avatar URL (manual) */}
        <div>
          <label className="block text-sm font-medium text-white/90 mb-1.5">
            Avatar URL
          </label>
          <input
            value={avatarUrl.startsWith("data:") ? "(uploaded file)" : avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://..."
            disabled={avatarUrl.startsWith("data:")}
            className={DISABLED_INPUT_CLS}
          />
          <p className="mt-1 text-sm text-white/60">Direct URL to your avatar image, or upload above.</p>
        </div>

        {/* Email (read-only) */}
        <div>
          <label className="block text-sm font-medium text-white/90 mb-1.5">
            Email
          </label>
          <input
            value={email ?? "Not available"}
            disabled
            className={DISABLED_INPUT_CLS}
          />
          <p className="mt-1 text-sm text-white/60">Managed by Clerk authentication.</p>
        </div>

        {/* Save */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !isDirty}
            className={`rounded-lg px-5 py-2 text-sm font-semibold transition-all ${
              saving
                ? "bg-white/60 text-black/70 cursor-wait"
                : isDirty
                  ? "bg-white text-black hover:bg-white/90 active:scale-[0.97] shadow-md"
                  : "border border-white/15 text-white/30 cursor-not-allowed"
            }`}
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
          {saveMsg && (
            <span
              className={`inline-flex items-center gap-1.5 text-sm font-semibold ${
                saveMsg === "Saved"
                  ? "text-emerald-400"
                  : "text-rose-400"
              }`}
            >
              {saveMsg === "Saved" && (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {saveMsg}
            </span>
          )}
        </div>
      </section>

      {/* Section 2: Bank Context (read-only + actions) */}
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-widest text-white/50">
          Bank Context
        </h2>
        <p className="text-sm text-white/60">
          Bank-scoped docs and deal tenancy use your active bank.
        </p>

        {/* Active bank info */}
        {currentBank ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-white/90 mb-1.5">
                Active Bank
              </label>
              <input
                value={currentBank.name}
                disabled
                className={DISABLED_INPUT_CLS}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/90 mb-1.5">
                Bank ID
              </label>
              <input
                value={currentBank.id}
                disabled
                className={`${DISABLED_INPUT_CLS} font-mono text-xs`}
              />
            </div>
            {currentBankRole && (
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1.5">
                  Membership Role
                </label>
                <input
                  value={currentBankRole}
                  disabled
                  className={DISABLED_INPUT_CLS}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
            No bank configured. Create one to start working with deals and documents.
          </div>
        )}

        {/* Bank switcher (if multiple memberships) */}
        {memberships.length > 1 && (
          <div>
            <label className="block text-sm font-medium text-white/90 mb-1.5">
              Switch Bank
            </label>
            <select
              value={currentBank?.id ?? ""}
              onChange={(e) => handleBankSwitch(e.target.value)}
              disabled={switchingBank}
              className={DISABLED_INPUT_CLS}
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

        {/* Create Bank */}
        {showCreateBank ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
            <div className="text-sm font-semibold text-white/80">Create a New Bank</div>
            <div>
              <label className="block text-sm font-medium text-white/90 mb-1.5">
                Bank Name
              </label>
              <input
                value={newBankName}
                onChange={(e) => setNewBankName(e.target.value)}
                placeholder="e.g. Paller Bank"
                className={INPUT_CLS}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCreateBank}
                disabled={creatingBank || !newBankName.trim()}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                  creatingBank
                    ? "bg-white/60 text-black/70 cursor-wait"
                    : newBankName.trim()
                      ? "bg-white text-black hover:bg-white/90 active:scale-[0.97] shadow-md"
                      : "border border-white/15 text-white/30 cursor-not-allowed"
                }`}
              >
                {creatingBank ? "Creating..." : "Create & Switch"}
              </button>
              <button
                type="button"
                onClick={() => setShowCreateBank(false)}
                className="text-sm text-white/50 hover:text-white/80 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowCreateBank(true)}
            className="text-sm font-medium text-white hover:text-white/80 transition-colors border border-white/15 rounded-lg px-3 py-1.5 hover:bg-white/5"
          >
            + Create new bank
          </button>
        )}
      </section>

      {/* Section 3: Diagnostics (read-only + copy) */}
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-widest text-white/50">
            Diagnostics
          </h2>
          <button
            type="button"
            onClick={handleCopyDiagnostics}
            className="text-xs font-medium text-white/70 hover:text-white transition-colors border border-white/15 rounded-lg px-2.5 py-1 hover:bg-white/5"
          >
            {copied ? "Copied!" : "Copy diagnostics"}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-white/50">Clerk User ID:</span>{" "}
            <span className="font-mono text-xs text-white/80">{profile?.clerk_user_id ?? "—"}</span>
          </div>
          <div>
            <span className="text-white/50">Profile ID:</span>{" "}
            <span className="font-mono text-xs text-white/80">{profile?.id ?? "—"}</span>
          </div>
          <div>
            <span className="text-white/50">Email:</span>{" "}
            <span className="text-white/80">{email ?? "—"}</span>
          </div>
          <div>
            <span className="text-white/50">Bank ID:</span>{" "}
            <span className="font-mono text-xs text-white/80">{currentBank?.id ?? "—"}</span>
          </div>
          {process.env.NEXT_PUBLIC_GIT_SHA && (
            <div>
              <span className="text-white/50">Build:</span>{" "}
              <span className="font-mono text-xs text-white/80">
                {process.env.NEXT_PUBLIC_GIT_SHA.slice(0, 7)}
              </span>
            </div>
          )}
          {process.env.NEXT_PUBLIC_VERCEL_ENV && (
            <div>
              <span className="text-white/50">Environment:</span>{" "}
              <span className="text-white/80">{process.env.NEXT_PUBLIC_VERCEL_ENV}</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
